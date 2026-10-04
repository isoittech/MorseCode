"""Text-only cloud adapters behind the same AG-UI coaching interface."""

import asyncio
import concurrent.futures
import contextlib
import logging
import threading
from collections.abc import AsyncIterator

import anthropic
import boto3
import httpx2
import openai
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .coach import INSTRUCTIONS, CoachUnavailable, CodexCoach
from .config import Settings

logger = logging.getLogger(__name__)
PROVIDER_NAMES = {
    "openai": "OpenAI",
    "azure": "Azure OpenAI",
    "bedrock": "Amazon Bedrock",
    "anthropic": "Anthropic",
}


class BedrockRun:
    """Close the stream on cancellation, including cancellation while connecting."""

    def __init__(self):
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.stream = None

    def attach(self, stream):
        with self.lock:
            self.stream = stream
            if self.stopped.is_set():
                stream.close()

    def stop(self):
        self.stopped.set()
        with self.lock:
            if self.stream is not None:
                self.stream.close()


class CloudCoach:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.provider = settings.morse_ai_provider
        self.name = PROVIDER_NAMES[self.provider]
        self.slots = asyncio.Semaphore(settings.morse_ai_max_concurrent)
        # An aborted SDK connection can take until its socket timeout to return.
        # Keep its worker permit until then, even after the HTTP request is cancelled.
        self.worker_slots = threading.BoundedSemaphore(settings.morse_ai_max_concurrent)
        self.workers: dict[asyncio.Task, BedrockRun] = {}

    def status(self) -> dict:
        s = self.settings
        configured = {
            "openai": bool(s.openai_api_key.get_secret_value() and s.openai_model.strip()),
            "azure": bool(
                s.azure_openai_api_key.get_secret_value()
                and s.azure_openai_endpoint
                and s.azure_openai_deployment.strip()
            ),
            "anthropic": bool(s.anthropic_api_key.get_secret_value() and s.anthropic_model.strip()),
            # Credentials and region may come from an AWS profile or an instance/task role.
            # Do not resolve that chain (which can use the network) during a status request.
            "bedrock": bool(s.bedrock_model_id.strip()),
        }[self.provider]
        return {
            "available": configured,
            "provider": self.provider,
            "message": "接続は初回の相談時に確認します"
            if configured
            else f"{self.name}の接続設定が未完了です。管理者に設定を確認してください。",
        }

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        status = self.status()
        if not status["available"]:
            raise CoachUnavailable(status["message"])
        try:
            await asyncio.wait_for(self.slots.acquire(), timeout=2)
        except TimeoutError as exc:
            raise CoachUnavailable("コーチが応答中です。少し待ってから再送してください。") from exc
        emitted = False
        try:
            async with asyncio.timeout(self.settings.morse_ai_timeout_seconds):
                source = (
                    self._bedrock(prompt)
                    if self.provider == "bedrock"
                    else self._anthropic(prompt)
                    if self.provider == "anthropic"
                    else self._responses(prompt)
                )
                async with contextlib.aclosing(source):
                    async for delta in source:
                        if delta:
                            emitted = True
                            yield delta
                if not emitted:
                    raise CoachUnavailable(
                        "コーチからテキスト応答がありませんでした。もう一度お試しください。"
                    )
        except (TimeoutError, openai.APITimeoutError, anthropic.APITimeoutError) as exc:
            raise CoachUnavailable(
                "コーチの応答が時間内に届きませんでした。練習は続けられます。"
            ) from exc
        except (openai.APIError, anthropic.APIError, BotoCoreError, ClientError) as exc:
            # SDK errors can contain credentials, endpoint URLs and submitted messages.
            logger.warning(
                "AI provider failed: provider=%s type=%s", self.provider, type(exc).__name__
            )
            status_code = getattr(exc, "status_code", None)
            if isinstance(exc, ClientError):
                status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status_code in (401, 403):
                detail = "認証に失敗しました。管理者にAPIキー・アクセス権を確認してください。"
            elif status_code == 429:
                detail = "利用上限に達しています。少し待ってから再送してください。"
            else:
                detail = "接続できません。管理者に認証・モデル・接続先の設定を確認してください。"
            raise CoachUnavailable(
                f"{self.name}に{detail}"
                if status_code not in (401, 403, 429)
                else f"{self.name}の{detail}"
            ) from exc
        finally:
            self.slots.release()

    async def _responses(self, prompt: str) -> AsyncIterator[str]:
        s = self.settings
        azure = self.provider == "azure"
        async with openai.AsyncOpenAI(
            api_key=(s.azure_openai_api_key if azure else s.openai_api_key).get_secret_value(),
            base_url=s.azure_base_url if azure else "https://api.openai.com/v1/",
            timeout=httpx2.Timeout(s.morse_ai_timeout_seconds, connect=5),
            max_retries=1,
        ) as client:
            stream = await client.responses.create(
                model=s.azure_openai_deployment if azure else s.openai_model,
                instructions=INSTRUCTIONS,
                input=prompt,
                tools=[],
                tool_choice="none",
                store=False,
                max_output_tokens=s.morse_ai_max_output_tokens,
                stream=True,
            )
            completed = False
            async with stream:
                async for event in stream:
                    if event.type == "response.output_text.delta":
                        yield event.delta
                    elif event.type == "response.completed":
                        completed = event.response.status == "completed"
                    elif event.type in (
                        "error",
                        "response.failed",
                        "response.incomplete",
                        "response.refusal.delta",
                    ):
                        raise CoachUnavailable(
                            "コーチの応答が完了しませんでした。質問を短くするか、管理者にモデルと出力上限を確認してください。"
                        )
            if not completed:
                raise CoachUnavailable(
                    "コーチとの接続が途中で終了しました。もう一度お試しください。"
                )

    async def _anthropic(self, prompt: str) -> AsyncIterator[str]:
        s = self.settings
        async with (
            anthropic.AsyncAnthropic(
                api_key=s.anthropic_api_key.get_secret_value(),
                base_url="https://api.anthropic.com",
                timeout=httpx2.Timeout(s.morse_ai_timeout_seconds, connect=5),
                max_retries=1,
            ) as client,
            client.messages.stream(
                model=s.anthropic_model,
                max_tokens=s.morse_ai_max_output_tokens,
                system=INSTRUCTIONS,
                messages=[{"role": "user", "content": prompt}],
            ) as stream,
        ):
            async for text in stream.text_stream:
                yield text
            message = await stream.get_final_message()
            if message.stop_reason not in ("end_turn", "stop_sequence"):
                raise CoachUnavailable(
                    "コーチの応答が完了しませんでした。質問を短くするか、管理者にモデルと出力上限を確認してください。"
                )

    def _bedrock_client(self):
        s = self.settings
        credentials = {}
        if s.aws_access_key_id.get_secret_value():
            credentials = {
                "aws_access_key_id": s.aws_access_key_id.get_secret_value(),
                "aws_secret_access_key": s.aws_secret_access_key.get_secret_value(),
                "aws_session_token": s.aws_session_token.get_secret_value() or None,
            }
        session = boto3.Session(profile_name=s.aws_profile or None, **credentials)
        return session.client(
            "bedrock-runtime",
            region_name=s.aws_region or s.aws_default_region or None,
            config=Config(
                connect_timeout=5,
                read_timeout=s.morse_ai_timeout_seconds,
                retries={"mode": "standard", "total_max_attempts": 2},
            ),
        )

    async def _bedrock(self, prompt: str) -> AsyncIterator[str]:
        if not self.worker_slots.acquire(blocking=False):
            raise CoachUnavailable(
                "Bedrockの接続を終了処理中です。少し待ってから再送してください。"
            )
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, object]] = asyncio.Queue(maxsize=16)
        run = BedrockRun()

        def emit(kind: str, value=None):
            if run.stopped.is_set():
                return
            future = asyncio.run_coroutine_threadsafe(queue.put((kind, value)), loop)
            try:
                while not run.stopped.is_set():
                    try:
                        future.result(timeout=0.1)
                        return
                    except concurrent.futures.TimeoutError:
                        continue
            finally:
                if not future.done():
                    future.cancel()

        def produce():
            try:
                with contextlib.closing(self._bedrock_client()) as client:
                    if run.stopped.is_set():
                        return
                    response = client.converse_stream(
                        modelId=self.settings.bedrock_model_id,
                        system=[{"text": INSTRUCTIONS}],
                        messages=[{"role": "user", "content": [{"text": prompt}]}],
                        inferenceConfig={"maxTokens": self.settings.morse_ai_max_output_tokens},
                    )
                    with contextlib.closing(response["stream"]) as stream:
                        run.attach(stream)
                        completed = False
                        for event in stream:
                            if run.stopped.is_set():
                                return
                            if any(key.endswith("Exception") for key in event):
                                raise CoachUnavailable(
                                    "Bedrockの応答中にエラーが発生しました。少し待ってから再送してください。"
                                )
                            if "contentBlockDelta" in event:
                                text = event["contentBlockDelta"].get("delta", {}).get("text")
                                if text:
                                    emit("text", text)
                            if "messageStop" in event:
                                completed = event["messageStop"].get("stopReason") in (
                                    "end_turn",
                                    "stop_sequence",
                                )
                        if not completed:
                            raise CoachUnavailable(
                                "Bedrockの応答が完了しませんでした。モデルと出力上限を確認してください。"
                            )
            except Exception as exc:
                emit("error", exc)
            finally:
                self.worker_slots.release()
                emit("done")

        task = asyncio.create_task(asyncio.to_thread(produce))
        self.workers[task] = run

        def done(worker: asyncio.Task):
            self.workers.pop(worker, None)
            if not worker.cancelled() and worker.exception():
                logger.warning("Bedrock worker failed: type=%s", type(worker.exception()).__name__)

        task.add_done_callback(done)
        try:
            while True:
                kind, value = await queue.get()
                if kind == "done":
                    break
                if kind == "error":
                    raise value
                yield value
        finally:
            run.stop()

    async def aclose(self):
        for run in list(self.workers.values()):
            run.stop()
        if self.workers:
            await asyncio.gather(*list(self.workers), return_exceptions=True)


def create_coach(settings: Settings) -> CodexCoach | CloudCoach:
    return CodexCoach(settings) if settings.morse_ai_provider == "codex" else CloudCoach(settings)
