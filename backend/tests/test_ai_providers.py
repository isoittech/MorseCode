import asyncio
import json
import threading
from unittest.mock import patch

import anthropic
import httpx2
import openai
import pytest
from botocore.exceptions import ClientError

from backend.app.ai_providers import CloudCoach, create_coach
from backend.app.coach import CoachUnavailable, CodexCoach
from backend.app.config import Settings


def settings(provider, **values):
    return Settings(
        _env_file=None,
        morse_ai_provider=provider,
        openai_api_key="openai-test-key",
        openai_model="openai-test-model",
        azure_openai_api_key="azure-test-key",
        azure_openai_endpoint="https://resource.openai.azure.com",
        azure_openai_deployment="training-deployment",
        anthropic_api_key="anthropic-test-key",
        anthropic_model="anthropic-test-model",
        bedrock_model_id="test.model-v1",
        aws_region="ap-northeast-1",
        **values,
    )


def sse(events):
    return "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events)


def response_events(ending="response.completed"):
    return [
        {"type": "response.output_text.delta", "delta": "短点は1、"},
        {"type": "response.output_text.delta", "delta": "長点は3です。"},
        {"type": ending, "response": {"id": "resp_test", "status": "completed"}},
    ]


def anthropic_events(stop_reason="end_turn"):
    return [
        {
            "type": "message_start",
            "message": {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": "test",
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": 10, "output_tokens": 0},
            },
        },
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "短点は1、"},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "長点は3です。"},
        },
        {"type": "content_block_stop", "index": 0},
        {
            "type": "message_delta",
            "delta": {"stop_reason": stop_reason, "stop_sequence": None},
            "usage": {"output_tokens": 10},
        },
        {"type": "message_stop"},
    ]


def mock_http_sdk(monkeypatch, provider, handler):
    module = anthropic if provider == "anthropic" else openai
    name = "AsyncAnthropic" if provider == "anthropic" else "AsyncOpenAI"
    real_client = getattr(module, name)
    transports = []
    options = []

    def factory(**kwargs):
        options.append(kwargs)
        http = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
        transports.append(http)
        return real_client(**kwargs, http_client=http)

    monkeypatch.setattr(module, name, factory)
    return transports, options


async def collect(coach):
    return "".join([text async for text in coach.stream("学習者の打鍵の相談")])


@pytest.mark.parametrize("provider", ["codex", "openai", "azure", "anthropic", "bedrock"])
def test_provider_selection_and_missing_config_does_not_fall_back(provider):
    coach = create_coach(Settings(_env_file=None, morse_ai_provider=provider))
    if provider == "codex":
        assert isinstance(coach, CodexCoach)
    else:
        assert isinstance(coach, CloudCoach)
        assert coach.status()["provider"] == provider
        assert not coach.status()["available"]
        with pytest.raises(CoachUnavailable, match="未完了"):
            asyncio.run(collect(coach))


@pytest.mark.parametrize("provider", ["openai", "azure", "anthropic"])
def test_real_sdk_streams_text_with_correct_auth_and_no_tools(monkeypatch, provider):
    requests = []

    def respond(request):
        requests.append(request)
        events = anthropic_events() if provider == "anthropic" else response_events()
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, text=sse(events))

    clients, options = mock_http_sdk(monkeypatch, provider, respond)
    coach = CloudCoach(settings(provider))
    assert asyncio.run(collect(coach)) == "短点は1、長点は3です。"
    assert len(requests) == 1
    request = requests[0]
    body = json.loads(request.content)
    assert body["stream"] is True
    assert options[0]["max_retries"] == 1
    if provider == "anthropic":
        assert str(request.url) == "https://api.anthropic.com/v1/messages"
        assert request.headers["x-api-key"] == "anthropic-test-key"
        assert body["model"] == "anthropic-test-model"
        assert body["system"].startswith("あなたはモールス")
        assert not body.get("tools")
        assert body["messages"][0]["content"] == "学習者の打鍵の相談"
    else:
        assert str(request.url) == (
            "https://resource.openai.azure.com/openai/v1/responses"
            if provider == "azure"
            else "https://api.openai.com/v1/responses"
        )
        assert request.headers["authorization"] == f"Bearer {provider}-test-key"
        assert body["model"] == (
            "training-deployment" if provider == "azure" else "openai-test-model"
        )
        assert body["store"] is False
        assert body["tools"] == []
        assert body["tool_choice"] == "none"
        assert body["instructions"].startswith("あなたはモールス")
        assert body["input"] == "学習者の打鍵の相談"
    assert all(client.is_closed for client in clients)
    assert "test-key" not in json.dumps(body, ensure_ascii=False)


@pytest.mark.parametrize("provider", ["openai", "azure", "anthropic"])
@pytest.mark.parametrize("status", [401, 429])
def test_provider_errors_are_actionable_and_sanitized(monkeypatch, caplog, provider, status):
    secret = "NEVER-EXPOSE-REQUEST-OR-API-KEY"

    def fail(_request):
        return httpx2.Response(
            status,
            json={"error": {"type": "authentication_error", "message": secret}},
            headers={"retry-after-ms": "1"},
        )

    clients, _ = mock_http_sdk(monkeypatch, provider, fail)
    with pytest.raises(CoachUnavailable, match="認証" if status == 401 else "利用上限") as error:
        asyncio.run(collect(CloudCoach(settings(provider))))
    assert secret not in str(error.value)
    assert secret not in caplog.text
    assert all(client.is_closed for client in clients)


@pytest.mark.parametrize(
    "ending", ["response.incomplete", "response.failed", "response.refusal.delta", "unexpected.end"]
)
def test_incomplete_openai_streams_are_not_reported_as_success(monkeypatch, ending):
    mock_http_sdk(
        monkeypatch,
        "openai",
        lambda _request: httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, text=sse(response_events(ending))
        ),
    )
    with pytest.raises(CoachUnavailable):
        asyncio.run(collect(CloudCoach(settings("openai"))))


def test_anthropic_output_limit_is_not_a_success(monkeypatch):
    mock_http_sdk(
        monkeypatch,
        "anthropic",
        lambda _request: httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=sse(anthropic_events("max_tokens")),
        ),
    )
    with pytest.raises(CoachUnavailable, match="完了しません"):
        asyncio.run(collect(CloudCoach(settings("anthropic"))))


def test_timeout_releases_http_client_and_capacity_for_next_request(monkeypatch):
    calls = 0

    async def respond(_request):
        nonlocal calls
        calls += 1
        if calls == 1:
            await asyncio.sleep(1)
        return httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, text=sse(response_events())
        )

    clients, _ = mock_http_sdk(monkeypatch, "openai", respond)
    config = settings("openai", morse_ai_max_concurrent=1)
    config.morse_ai_timeout_seconds = 0.03
    coach = CloudCoach(config)

    async def run():
        with pytest.raises(CoachUnavailable, match="時間内"):
            await collect(coach)
        config.morse_ai_timeout_seconds = 5
        assert await asyncio.wait_for(collect(coach), timeout=1) == "短点は1、長点は3です。"

    asyncio.run(run())
    assert all(client.is_closed for client in clients)


@pytest.mark.parametrize("provider", ["openai", "azure", "anthropic"])
def test_cancelled_cloud_stream_releases_client_and_capacity(monkeypatch, provider):
    events = anthropic_events() if provider == "anthropic" else response_events()
    clients, _ = mock_http_sdk(
        monkeypatch,
        provider,
        lambda _request: httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, text=sse(events)
        ),
    )
    coach = CloudCoach(settings(provider, morse_ai_max_concurrent=1))

    async def run():
        stream = coach.stream("取消のテスト")
        assert await anext(stream) == "短点は1、"
        await stream.aclose()
        assert clients[0].is_closed
        assert await asyncio.wait_for(collect(coach), timeout=1) == "短点は1、長点は3です。"

    asyncio.run(run())
    assert all(client.is_closed for client in clients)


class BedrockStream:
    def __init__(self, events):
        self.events = events
        self.closed = threading.Event()

    def __iter__(self):
        yield from self.events

    def close(self):
        self.closed.set()


class BedrockClient:
    def __init__(self, events):
        self.stream = BedrockStream(events)
        self.payload = None
        self.closed = False

    def converse_stream(self, **kwargs):
        self.payload = kwargs
        return {"stream": self.stream}

    def close(self):
        self.closed = True


BEDROCK_EVENTS = [
    {"contentBlockDelta": {"delta": {"text": "短点は1、"}}},
    {"contentBlockDelta": {"delta": {"reasoningContent": {"text": "private-reasoning"}}}},
    {"contentBlockDelta": {"delta": {"text": "長点は3です。"}}},
    {"messageStop": {"stopReason": "end_turn"}},
]


def test_bedrock_stream_uses_converse_and_closes_resources(monkeypatch):
    client = BedrockClient(BEDROCK_EVENTS)
    coach = CloudCoach(settings("bedrock"))
    monkeypatch.setattr(coach, "_bedrock_client", lambda: client)

    async def run():
        assert await collect(coach) == "短点は1、長点は3です。"
        await coach.aclose()

    asyncio.run(run())
    assert client.closed and client.stream.closed.is_set()
    assert client.payload["modelId"] == "test.model-v1"
    assert client.payload["system"][0]["text"].startswith("あなたはモールス")
    assert client.payload["messages"][0]["content"][0]["text"] == "学習者の打鍵の相談"
    assert "toolConfig" not in client.payload
    assert "test-key" not in json.dumps(client.payload)


@pytest.mark.parametrize(
    "events",
    [
        [{"modelStreamErrorException": {"message": "secret-service-details"}}],
        [{"messageStop": {"stopReason": "max_tokens"}}],
        BEDROCK_EVENTS[:-1],
    ],
)
def test_bedrock_stream_errors_and_truncation_are_not_success(monkeypatch, events):
    client = BedrockClient(events)
    coach = CloudCoach(settings("bedrock"))
    monkeypatch.setattr(coach, "_bedrock_client", lambda: client)

    async def run():
        with pytest.raises(CoachUnavailable) as error:
            await collect(coach)
        assert "secret-service-details" not in str(error.value)
        await coach.aclose()

    asyncio.run(run())
    assert client.closed and client.stream.closed.is_set()


def test_bedrock_credentials_profile_and_timeouts_are_configured():
    coach = CloudCoach(
        settings(
            "bedrock",
            aws_profile="training",
            aws_access_key_id="access",
            aws_secret_access_key="secret",
            aws_session_token="temporary",
        )
    )
    with patch("backend.app.ai_providers.boto3.Session") as session:
        coach._bedrock_client()
    assert session.call_args.kwargs == {
        "profile_name": "training",
        "aws_access_key_id": "access",
        "aws_secret_access_key": "secret",
        "aws_session_token": "temporary",
    }
    options = session.return_value.client.call_args.kwargs
    assert options["region_name"] == "ap-northeast-1"
    assert options["config"].connect_timeout == 5
    assert options["config"].read_timeout == 90


def test_bedrock_cancel_closes_blocked_stream_and_releases_worker(monkeypatch):
    client = BedrockClient([])

    def events():
        yield {"contentBlockDelta": {"delta": {"text": "最初の文"}}}
        client.stream.closed.wait(timeout=2)

    client.stream.events = events()
    coach = CloudCoach(settings("bedrock", morse_ai_max_concurrent=1))
    monkeypatch.setattr(coach, "_bedrock_client", lambda: client)

    async def run():
        stream = coach.stream("テスト")
        assert await anext(stream) == "最初の文"
        await stream.aclose()
        await asyncio.wait_for(coach.aclose(), timeout=1)
        fresh = BedrockClient(BEDROCK_EVENTS)
        monkeypatch.setattr(coach, "_bedrock_client", lambda: fresh)
        assert await collect(coach) == "短点は1、長点は3です。"
        await coach.aclose()

    asyncio.run(run())
    assert client.closed and client.stream.closed.is_set()


def test_bedrock_auth_error_is_sanitized_and_capacity_is_reusable(monkeypatch):
    coach = CloudCoach(settings("bedrock", morse_ai_max_concurrent=1))

    def fail():
        raise ClientError(
            {
                "Error": {"Code": "AccessDeniedException", "Message": "secret-arn"},
                "ResponseMetadata": {"HTTPStatusCode": 403},
            },
            "ConverseStream",
        )

    monkeypatch.setattr(coach, "_bedrock_client", fail)

    async def run():
        with pytest.raises(CoachUnavailable, match="認証") as error:
            await collect(coach)
        assert "secret-arn" not in str(error.value)
        await coach.aclose()
        monkeypatch.setattr(coach, "_bedrock_client", lambda: BedrockClient(BEDROCK_EVENTS))
        assert await collect(coach) == "短点は1、長点は3です。"
        await coach.aclose()

    asyncio.run(run())
