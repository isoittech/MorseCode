import asyncio
import sys
import textwrap

import pytest

from backend.app.coach import CoachUnavailable, CodexCoach
from backend.app.config import Settings


@pytest.fixture
def fake_server(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "no-auth"))
    script = tmp_path / "codex"
    script.write_text(
        f"#!{sys.executable}\n"
        + textwrap.dedent("""
        import json, sys
        def send(value):
            print(json.dumps(value), flush=True)
        for line in sys.stdin:
            m = json.loads(line)
            if m.get('method') == 'initialize':
                send({'id': m['id'], 'result': {}})
            elif m.get('method') == 'thread/start':
                if m['params'].get('sandbox') != 'read-only' or not m['params'].get('ephemeral'):
                    send({'id': m['id'], 'error': {'code': -32600}})
                else:
                    send({'id': m['id'], 'result': {'thread': {'id': 'training'}}})
            elif m.get('method') == 'turn/start':
                send({'method': 'item/agentMessage/delta', 'params': {'threadId': 'other-user', 'delta': 'DO NOT LEAK'}})
                send({'method': 'item/agentMessage/delta', 'params': {'threadId': 'training', 'delta': '短点1、'}})
                send({'id': m['id'], 'result': {'turn': {'id': 'turn'}}})
                send({'id': 999, 'method': 'item/tool/call', 'params': {}})
            elif m.get('id') == 999:
                assert m['error']['code'] == -32601
                send({'method': 'item/agentMessage/delta', 'params': {'threadId': 'training', 'delta': '長点3。'}})
                send({'method': 'turn/completed', 'params': {'threadId': 'training', 'turn': {'status': 'completed', 'items': []}}})
        """)
    )
    script.chmod(0o700)
    return script


def test_stdio_protocol_early_deltas_thread_isolation_and_tool_denial(fake_server, tmp_path):
    settings = Settings(
        _env_file=None, codex_command=str(fake_server), morse_codex_home=tmp_path / "home"
    )
    coach = CodexCoach(settings)

    async def run():
        return [chunk async for chunk in coach.stream("打鍵の練習")]

    assert asyncio.run(run()) == ["短点1、", "長点3。"]


def test_missing_executable_is_actionable_and_releases_slot(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "no-auth"))
    settings = Settings(
        _env_file=None, codex_command=str(tmp_path / "missing"), morse_codex_home=tmp_path / "home"
    )
    coach = CodexCoach(settings)

    async def run():
        with pytest.raises(CoachUnavailable, match="起動できません"):
            async for _ in coach.stream("テスト"):
                pass
        # A failed start must not exhaust the concurrency budget.
        with pytest.raises(CoachUnavailable, match="起動できません"):
            async for _ in coach.stream("再試行"):
                pass

    asyncio.run(run())
