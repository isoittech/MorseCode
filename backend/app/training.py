import json
import random
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .config import ROOT

CURRICULUM = json.loads((ROOT / "shared/curriculum.json").read_text())
ALPHABET = CURRICULUM["alphabet"]
DECODE = {v: k for k, v in ALPHABET.items()}
Mode = Literal["send", "receive", "knowledge", "decision"]


class Preferences(BaseModel):
    wpm: int = Field(default=12, ge=5, le=40)
    level: int = Field(default=1, ge=1, le=3)
    daily_goal: int = Field(default=10, ge=1, le=100)
    target_accuracy: int = Field(default=90, ge=80, le=100)


class Attempt(BaseModel):
    exercise_id: str = Field(min_length=1, max_length=64)
    answer: str = Field(default="", max_length=200)
    characters: list[list[float]] = Field(default_factory=list, max_length=40)
    input_method: Literal["key", "paddle"] = "key"
    elapsed_ms: float = Field(ge=0, le=3600000, allow_inf_nan=False)

    @field_validator("characters")
    @classmethod
    def validate_timings(cls, groups):
        import math

        for group in groups:
            if not 1 <= len(group) <= 10:
                raise ValueError("1文字の符号数は1〜10です")
            if any(not math.isfinite(v) or v < 10 or v > 10000 for v in group):
                raise ValueError("打鍵時間は10〜10000 msです")
        return groups


def make_exercise(mode: Mode, preferences: dict, stats: dict) -> dict:
    level = CURRICULUM["levels"][preferences["level"] - 1]
    exercise = {
        "id": str(uuid.uuid4()),
        "mode": mode,
        "level": level["level"],
        "wpm": preferences["wpm"],
        "title": level["name"],
        "options": [],
        "target": "",
        "signal": [],
        "explanation": "",
    }
    rng = random.SystemRandom()
    if mode in ("send", "receive"):
        pool = level["characters"]
        weak = [
            w["character"]
            for w in stats["weaknesses"]
            if w["character"] in pool and w["accuracy"] < preferences["target_accuracy"]
        ]
        target = "".join(rng.choice(pool + "".join(weak) * 3) for _ in range(level["length"]))
        # A recognizable first mission makes the input mechanics easier to learn.
        if not stats["total"] and mode == "send" and level["level"] == 1:
            target = "KMK"
        exercise.update(
            target=target,
            answer=target,
            signal=[ALPHABET[c] for c in target],
            prompt="次の文字列を送信せよ。"
            if mode == "send"
            else "音を聴き、受信した文字列を入力せよ。",
        )
    else:
        exercise.update(rng.choice(CURRICULUM[mode]))
        exercise["title"] = "通信の基礎知識" if mode == "knowledge" else "状況判断ドリル"
    return exercise


def public_exercise(exercise: dict) -> dict:
    value = {k: v for k, v in exercise.items() if k not in ("answer", "explanation")}
    if exercise["mode"] == "receive":
        value["target"] = ""
    return value


def alignment(expected: str, actual: str) -> tuple[int, list[dict]]:
    # Levenshtein alignment keeps one missed character from shifting the whole grade.
    table = [[0] * (len(actual) + 1) for _ in range(len(expected) + 1)]
    for i in range(len(expected) + 1):
        table[i][0] = i
    for j in range(len(actual) + 1):
        table[0][j] = j
    for i, left in enumerate(expected, 1):
        for j, right in enumerate(actual, 1):
            table[i][j] = min(
                table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + int(left != right)
            )
    i, j = len(expected), len(actual)
    characters = []
    while i or j:
        if i and j and table[i][j] == table[i - 1][j - 1] + int(expected[i - 1] != actual[j - 1]):
            characters.append(
                {
                    "expected": expected[i - 1],
                    "actual": actual[j - 1],
                    "correct": expected[i - 1] == actual[j - 1],
                }
            )
            i, j = i - 1, j - 1
        elif i and table[i][j] == table[i - 1][j] + 1:
            characters.append({"expected": expected[i - 1], "actual": "", "correct": False})
            i -= 1
        else:
            j -= 1
    return table[-1][-1], list(reversed(characters))


def grade(exercise: dict, attempt: Attempt) -> dict:
    unit = 1200 / exercise["wpm"]
    rhythm = None
    if exercise["mode"] == "send":
        if not attempt.characters:
            raise ValueError("符号を入力してから判定してください")
        codes = [
            "".join("." if d < 2 * unit else "-" for d in group) for group in attempt.characters
        ]
        actual = "".join(DECODE.get(c, "�") for c in codes)
        if attempt.input_method == "key":
            errors = [
                abs(d - (unit if d < 2 * unit else 3 * unit)) / (unit if d < 2 * unit else 3 * unit)
                for group in attempt.characters
                for d in group
            ]
            rhythm = round(max(0, 1 - sum(errors) / len(errors)) * 100)
    else:
        actual = attempt.answer.strip()
        if exercise["mode"] == "receive":
            actual = "".join(actual.upper().split())
        if not actual:
            raise ValueError("回答を入力してください")
    expected = exercise["answer"]
    if exercise["mode"] in ("send", "receive"):
        distance, characters = alignment(expected, actual)
        accuracy = round(max(0, 1 - distance / max(len(expected), len(actual), 1)) * 100)
    else:
        accuracy, characters = (100 if actual == expected else 0), []
    feedback = []
    if accuracy == 100:
        feedback.append("符号はすべて正確。次もこの精度を維持しよう。")
    elif characters:
        misses = [
            f"{c['expected']}（{ALPHABET[c['expected']]}）" for c in characters if not c["correct"]
        ]
        feedback.append(
            "要修正：" + "、".join(misses)
            if misses
            else "余分な文字が入っている。文字数と区切りを確認しよう。"
        )
    else:
        feedback.append("正解は「" + expected + "」。")
    if rhythm is not None:
        feedback.append(
            "長短点の長さが不安定。短点1：長点3の比率に集中しよう。"
            if rhythm < 75
            else "長短点の比率は安定している。文字間の3単位も意識しよう。"
        )
    if exercise["explanation"]:
        feedback.append(exercise["explanation"])
    if exercise["mode"] == "decision" and attempt.elapsed_ms > 15000:
        feedback.append(
            "判断に15秒以上かかっている。まず理由を整理し、次回は15秒以内の正答を目指そう。"
        )
    return {
        "id": exercise["id"],
        "mode": exercise["mode"],
        "expected": expected,
        "actual": actual,
        "accuracy": accuracy,
        "rhythm": rhythm,
        "wpm": exercise["wpm"],
        "elapsed_ms": attempt.elapsed_ms,
        "characters": characters,
        "feedback": feedback,
        "input_method": attempt.input_method,
    }
