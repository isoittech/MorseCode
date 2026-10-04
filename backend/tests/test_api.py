import json
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.auth import AuthenticationFailed, DirectoryUnavailable
from backend.app.coach import CoachUnavailable
from backend.app.config import Settings
from backend.app.main import COOKIE, create_app
from backend.app.training import ALPHABET

HEADERS = {"X-Morse-Client": "web"}


@pytest.fixture
def client(tmp_path):
    app = create_app(
        Settings(
            _env_file=None, morse_demo_enabled=True, morse_database_path=tmp_path / "test.sqlite3"
        )
    )
    with TestClient(app, headers=HEADERS) as client:
        yield client


def login(client):
    response = client.post("/api/auth/demo")
    assert response.status_code == 200
    return response.json()


def test_all_training_and_coach_routes_require_login(client):
    for route in ["/api/stats", "/api/preferences", "/api/coach/status", "/api/auth/me"]:
        assert client.get(route).status_code == 401
    assert client.post("/api/exercises/next").status_code == 401
    assert client.post("/api/coach", json={}).status_code == 401
    assert client.post("/api/onboarding/seen").status_code == 401


def test_session_security_logout_revocation_and_expiry(client):
    response = client.post("/api/auth/demo")
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    token = client.cookies.get(COOKIE)
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    client.cookies.set(COOKIE, token)
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.clear()
    login(client)
    with client.app.state.database.connect() as db:
        db.execute("UPDATE sessions SET expires=?", (time.time() - 1,))
    assert client.get("/api/auth/me").status_code == 401


def test_csrf_and_body_limits(client):
    assert client.post("/api/auth/demo", headers={"X-Morse-Client": ""}).status_code == 403
    assert (
        client.post("/api/auth/demo", headers={"Origin": "https://foreign.example"}).status_code
        == 403
    )
    assert client.post("/api/auth/demo", headers={"Origin": "http://testserver"}).status_code == 200
    assert client.post("/api/auth/login", content="x" * 70000).status_code == 413
    secret = "private-password" * 100
    response = client.post("/api/auth/login", json={"username": "test", "password": secret})
    assert response.status_code == 422
    assert "private-password" not in response.text


def test_ldap_login_uses_server_validation(client):
    profile = {"id": "ldap:test", "username": "test", "display_name": "訓練生", "demo": False}
    with patch("backend.app.auth.authenticate", return_value=profile):
        assert (
            client.post("/api/auth/login", json={"username": "test", "password": "secret"}).json()
            == profile
        )
    with patch("backend.app.auth.authenticate", side_effect=AuthenticationFailed):
        assert (
            client.post(
                "/api/auth/login", json={"username": "test", "password": "wrong"}
            ).status_code
            == 401
        )
    with patch("backend.app.auth.authenticate", side_effect=DirectoryUnavailable("LDAP接続に失敗")):
        assert (
            client.post(
                "/api/auth/login", json={"username": "test", "password": "secret"}
            ).status_code
            == 503
        )


def test_demo_disabled_by_default(tmp_path):
    with TestClient(
        create_app(Settings(_env_file=None, morse_database_path=tmp_path / "prod.db")),
        headers=HEADERS,
    ) as client:
        assert client.post("/api/auth/demo").status_code == 404


def test_login_rate_limit(client):
    with patch("backend.app.auth.authenticate", side_effect=AuthenticationFailed):
        for _ in range(10):
            assert (
                client.post("/api/auth/login", json={"username": "x", "password": "x"}).status_code
                == 401
            )
        assert (
            client.post("/api/auth/login", json={"username": "x", "password": "x"}).status_code
            == 429
        )


def test_exercise_grading_persistence_and_idempotency(client):
    login(client)
    exercise = client.post("/api/exercises/next?mode=send").json()
    payload = {
        "exercise_id": exercise["id"],
        "elapsed_ms": 3000,
        "characters": [[100 if s == "." else 300 for s in ALPHABET[c]] for c in exercise["target"]],
    }
    response = client.post("/api/attempts", json=payload)
    assert response.status_code == 200
    assert response.json()["accuracy"] == 100
    assert client.post("/api/attempts", json=payload).json() == response.json()
    stats = client.get("/api/stats").json()
    assert stats["total"] == 1
    assert stats["today"] == 1
    assert stats["weaknesses"][0]["accuracy"] == 100
    assert len(stats["recent"]) == 1


def test_users_cannot_read_or_submit_each_others_exercises(client):
    login(client)
    exercise = client.post("/api/exercises/next").json()
    client.post("/api/auth/logout")
    login(client)
    assert (
        client.post(
            "/api/attempts",
            json={"exercise_id": exercise["id"], "elapsed_ms": 100, "characters": [[100]]},
        ).status_code
        == 404
    )
    assert client.get("/api/stats").json()["total"] == 0


def test_preferences_validate_and_control_next_exercise(client):
    login(client)
    assert client.put("/api/preferences", json={"wpm": 0}).status_code == 422
    response = client.put(
        "/api/preferences", json={"wpm": 20, "level": 3, "daily_goal": 15, "target_accuracy": 95}
    )
    assert response.status_code == 200
    assert client.get("/api/preferences").json() == response.json()
    exercise = client.post("/api/exercises/next?mode=receive").json()
    assert exercise["wpm"] == 20
    assert exercise["level"] == 3
    assert not exercise["target"]
    assert "answer" not in exercise


def test_onboarding_is_saved_per_user_without_resetting_training_preferences(client):
    login(client)
    first_session = client.cookies.get(COOKIE)
    assert client.get("/api/preferences").json()["onboarding_seen"] is False
    client.put("/api/preferences", json={"wpm": 8, "level": 2})
    saved = client.post("/api/onboarding/seen")
    assert saved.status_code == 200
    assert saved.json()["onboarding_seen"] is True
    assert saved.json()["wpm"] == 8
    # Older clients and the settings screen only update the training fields.
    updated = client.put("/api/preferences", json={"wpm": 15, "level": 3})
    assert updated.json()["onboarding_seen"] is True
    assert updated.json()["wpm"] == 15
    assert client.post("/api/onboarding/seen").json() == updated.json()
    assert client.post("/api/onboarding/seen", headers={"X-Morse-Client": ""}).status_code == 403
    client.cookies.clear()
    login(client)
    assert client.get("/api/preferences").json()["onboarding_seen"] is False
    client.cookies.clear()
    client.cookies.set(COOKIE, first_session)
    assert client.get("/api/preferences").json()["onboarding_seen"] is True
    assert client.get("/api/stats").json()["total"] == 0


class FakeCoach:
    failure = False
    prompt = None

    async def stream(self, prompt):
        self.prompt = prompt
        if self.failure:
            raise CoachUnavailable("一時的に接続できません")
        yield "短点は1単位、"
        yield "長点は3単位です。"


def test_ag_ui_streams_text_and_handles_failures(client):
    login(client)
    coach = FakeCoach()
    client.app.state.coach = coach
    request = {
        "threadId": "thread-1",
        "runId": "run-1",
        "state": {},
        "tools": [],
        "context": [],
        "messages": [{"id": "message-1", "role": "user", "content": "コツは？"}],
        "forwardedProps": {},
    }
    response = client.post("/api/coach", json=request)
    assert response.status_code == 200
    events = [json.loads(s.removeprefix("data: ")) for s in response.text.strip().split("\n\n")]
    assert events[0]["type"] == "RUN_STARTED"
    assert events[-1]["type"] == "RUN_FINISHED"
    assert "長点は3単位" in response.text
    assert "demo:" not in coach.prompt
    assert not client.app.state.coaching_users
    coach.failure = True
    response = client.post("/api/coach", json=request)
    assert '"RUN_ERROR"' in response.text
    assert "一時的に接続できません" in response.text
    assert not client.app.state.coaching_users
