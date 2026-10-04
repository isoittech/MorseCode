import math

import pytest
from pydantic import ValidationError

from backend.app.training import ALPHABET, Attempt, alignment, grade, public_exercise


def exercise(target="KMK", mode="send"):
    return {
        "id": "one",
        "mode": mode,
        "wpm": 12,
        "answer": target,
        "target": target,
        "explanation": "",
        "signal": [ALPHABET[c] for c in target],
    }


def attempt(target="KMK", **kwargs):
    return Attempt(
        exercise_id="one",
        characters=[[100 if symbol == "." else 300 for symbol in ALPHABET[c]] for c in target],
        elapsed_ms=1000,
        **kwargs,
    )


def test_grades_real_key_durations():
    result = grade(exercise(), attempt())
    assert result["actual"] == "KMK"
    assert result["accuracy"] == 100
    assert result["rhythm"] == 100


def test_partial_accuracy_and_uneven_rhythm():
    response = Attempt(
        exercise_id="one", characters=[[450, 180, 450], [300, 300], [100]], elapsed_ms=1000
    )
    result = grade(exercise(), response)
    assert result["accuracy"] == 67
    assert result["rhythm"] < 75
    assert result["characters"][-1]["expected"] == "K"


def test_assisted_input_does_not_claim_timing_quality():
    assert grade(exercise(), attempt(input_method="paddle"))["rhythm"] is None


def test_one_missing_character_does_not_shift_the_entire_grade():
    distance, characters = alignment("KMK", "KK")
    assert distance == 1
    assert sum(c["correct"] for c in characters) == 2
    assert grade(exercise(), attempt("KK"))["accuracy"] == 67


def test_extra_characters_are_penalized():
    assert grade(exercise(), attempt("KMKE"))["accuracy"] == 75


def test_receive_normalizes_case_and_spaces_and_hides_answer():
    assert public_exercise(exercise(mode="receive"))["target"] == ""
    assert "answer" not in public_exercise(exercise(mode="receive"))
    assert (
        grade(
            exercise(mode="receive"), Attempt(exercise_id="one", answer="k m k", elapsed_ms=1000)
        )["accuracy"]
        == 100
    )


@pytest.mark.parametrize("duration", [0, -1, math.inf, math.nan, 10001])
def test_invalid_timings_rejected(duration):
    with pytest.raises(ValidationError):
        Attempt(exercise_id="one", characters=[[duration]], elapsed_ms=100)


def test_empty_submission_rejected():
    with pytest.raises(ValueError, match="符号"):
        grade(exercise(), Attempt(exercise_id="one", elapsed_ms=100))
