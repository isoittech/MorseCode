import hashlib
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, profile TEXT NOT NULL, preferences TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    expires REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS exercises (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    payload TEXT NOT NULL, created REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attempts (
                    id TEXT PRIMARY KEY REFERENCES exercises(id),
                    user_id TEXT NOT NULL REFERENCES users(id), result TEXT NOT NULL, created REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id, created DESC);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
                PRAGMA user_version=1;
            """)
        path.chmod(0o600)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def token_hash(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def login(self, profile: dict) -> str:
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute(
                "INSERT INTO users(id, profile) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile",
                (profile["id"], json.dumps(profile)),
            )
            db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
            db.execute(
                "INSERT INTO sessions VALUES(?, ?, ?)",
                (self.token_hash(token), profile["id"], time.time() + 8 * 3600),
            )
        return token

    def user(self, token: str) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT profile FROM users JOIN sessions ON users.id=sessions.user_id WHERE token_hash=? AND expires>?",
                (self.token_hash(token), time.time()),
            ).fetchone()
        return json.loads(row["profile"]) if row else None

    def logout(self, token: str):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (self.token_hash(token),))

    def preferences(self, user_id: str, value: dict | None = None) -> dict:
        with self.connect() as db:
            if value is not None:
                db.execute(
                    "UPDATE users SET preferences=json_patch(preferences, ?) WHERE id=?",
                    (json.dumps(value), user_id),
                )
            row = db.execute("SELECT preferences FROM users WHERE id=?", (user_id,)).fetchone()
        return {
            "wpm": 12,
            "level": 1,
            "daily_goal": 10,
            "target_accuracy": 90,
            "onboarding_seen": False,
            **json.loads(row["preferences"]),
        }

    def save_exercise(self, user_id: str, exercise: dict):
        with self.connect() as db:
            # Unanswered exercises expire; answered exercises remain referenced by attempts.
            db.execute(
                "DELETE FROM exercises WHERE created<? AND id NOT IN (SELECT id FROM attempts)",
                (time.time() - 3600,),
            )
            db.execute(
                "INSERT INTO exercises VALUES(?, ?, ?, ?)",
                (exercise["id"], user_id, json.dumps(exercise), time.time()),
            )

    def exercise(self, user_id: str, exercise_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT payload FROM exercises WHERE id=? AND user_id=? AND created>?",
                (exercise_id, user_id, time.time() - 3600),
            ).fetchone()
        return json.loads(row["payload"]) if row else None

    def record(self, user_id: str, result: dict) -> dict:
        with self.connect() as db:
            db.execute(
                "INSERT OR IGNORE INTO attempts VALUES(?, ?, ?, ?)",
                (result["id"], user_id, json.dumps(result), time.time()),
            )
            row = db.execute(
                "SELECT result FROM attempts WHERE id=? AND user_id=?", (result["id"], user_id)
            ).fetchone()
        return json.loads(row["result"])

    def stats(self, user_id: str) -> dict:
        with self.connect() as db:
            rows = db.execute(
                "SELECT result, created FROM attempts WHERE user_id=? ORDER BY created DESC LIMIT 200",
                (user_id,),
            ).fetchall()
            total = db.execute(
                "SELECT count(*) FROM attempts WHERE user_id=?", (user_id,)
            ).fetchone()[0]
            midnight = (
                datetime.now(ZoneInfo("Asia/Tokyo"))
                .replace(hour=0, minute=0, second=0, microsecond=0)
                .timestamp()
            )
            daily = db.execute(
                "SELECT count(*) FROM attempts WHERE user_id=? AND created>=?", (user_id, midnight)
            ).fetchone()[0]
        records = [{**json.loads(row["result"]), "created_at": row["created"]} for row in rows]
        averages = {}
        for mode in ("send", "receive", "knowledge", "decision"):
            values = [r["accuracy"] for r in records if r["mode"] == mode]
            averages[mode] = round(sum(values) / len(values)) if values else None
        weak: dict[str, list[int]] = {}
        for record in records:
            if record["mode"] not in ("send", "receive"):
                continue
            for c in record["characters"]:
                entry = weak.setdefault(c["expected"], [0, 0])
                entry[0] += int(c["correct"])
                entry[1] += 1
        weaknesses = sorted(
            [
                {"character": c, "accuracy": round(v[0] / v[1] * 100), "attempts": v[1]}
                for c, v in weak.items()
            ],
            key=lambda x: (x["accuracy"], -x["attempts"]),
        )
        streak = 0
        for record in records:
            if record["accuracy"] < 90:
                break
            streak += 1
        return {
            "total": total,
            "today": daily,
            "streak": streak,
            "accuracy": round(sum(r["accuracy"] for r in records) / len(records))
            if records
            else None,
            "by_mode": averages,
            "weaknesses": weaknesses[:8],
            "recent": records[:20],
        }
