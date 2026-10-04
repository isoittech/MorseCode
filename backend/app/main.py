import asyncio
import json
import logging
import secrets
import time
import uuid
from collections import defaultdict, deque
from contextlib import aclosing, asynccontextmanager
from urllib.parse import urlsplit

from ag_ui.core import RunAgentInput
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth
from .ai_providers import CloudCoach, create_coach
from .coach import CoachUnavailable
from .config import ROOT, Settings
from .database import Database
from .training import Attempt, Mode, Preferences, grade, make_exercise, public_exercise

logger = logging.getLogger(__name__)
COOKIE = "morse_session"


class LoginInput(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=1024, repr=False)


class RateLimiter:
    def __init__(self):
        self.entries: dict[str, deque] = defaultdict(deque)

    def check(self, key: str, limit: int, window: int = 60):
        now = time.monotonic()
        if len(self.entries) > 10000:
            self.entries = defaultdict(
                deque, {k: q for k, q in self.entries.items() if q and q[-1] > now - window}
            )
        attempts = self.entries[key]
        while attempts and attempts[0] <= now - window:
            attempts.popleft()
        if len(attempts) >= limit:
            raise HTTPException(
                429,
                "操作が多すぎます。1分ほど待ってください。",
                headers={"Retry-After": str(window)},
            )
        attempts.append(now)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    database = Database(settings.morse_database_path)
    limiter = RateLimiter()
    coach = create_coach(settings)

    @asynccontextmanager
    async def lifespan(_app):
        # Environment changes take effect on restart; old admin credentials must not
        # leave authenticated sessions behind after a password rotation or disable.
        database.revoke_user_sessions("local:admin")
        try:
            yield
        finally:
            if isinstance(coach, CloudCoach):
                await coach.aclose()

    app = FastAPI(title="Morse Field Station", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.database = database
    app.state.coach = coach
    app.state.settings = settings
    app.state.coaching_users = set()

    @app.middleware("http")
    async def protect_requests(request: Request, call_next):
        if request.url.path.startswith("/api"):
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                if request.headers.get("x-morse-client") != "web":
                    return JSONResponse(
                        {"detail": "クライアント識別ヘッダーが必要です"}, status_code=403
                    )
                origin = request.headers.get("origin")
                if origin and urlsplit(origin).netloc != request.headers.get("host"):
                    return JSONResponse(
                        {"detail": "異なるサイトからの操作は許可されていません"}, status_code=403
                    )
                chunks = []
                size = 0
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 65536:
                        return JSONResponse({"detail": "送信内容が大きすぎます"}, status_code=413)
                    chunks.append(chunk)
                request._body = b"".join(chunks)
            response = await call_next(request)
            response.headers["Cache-Control"] = "no-store"
        else:
            response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(Exception)
    async def unexpected_error(_request: Request, exc: Exception):
        logger.error("Unhandled application error: %s", type(exc).__name__)
        return JSONResponse(
            {"detail": "サーバーで処理できませんでした。もう一度お試しください。"}, status_code=500
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError):
        # Default validation errors can echo a submitted password in their input field.
        return JSONResponse(
            {"detail": "入力内容を確認してください。形式または許容範囲が正しくありません。"},
            status_code=422,
        )

    def current_user(request: Request):
        user = database.user(request.cookies.get(COOKIE, ""))
        if user and (
            (user["id"] == "local:admin" and not settings.admin_enabled)
            or (user["id"].startswith("ldap:") and not settings.ldap_enabled)
        ):
            database.logout(request.cookies.get(COOKIE, ""))
            user = None
        if not user:
            raise HTTPException(401, "ログインが必要です")
        return user

    def set_login(response: Response, profile: dict, request: Request):
        database.logout(request.cookies.get(COOKIE, ""))
        response.set_cookie(
            COOKIE,
            database.login(profile),
            httponly=True,
            secure=settings.morse_cookie_secure,
            samesite="strict",
            max_age=28800,
        )
        return profile

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/api/auth/config")
    def auth_config():
        return {
            "demo_enabled": settings.morse_demo_enabled,
            "ldap_enabled": settings.ldap_enabled,
            "admin_enabled": settings.admin_enabled,
            "plaintext": settings.ldap_enabled and settings.ldap_plaintext,
            "notice_emphasis_until": settings.ldap_login_notice_emphasis_until,
        }

    @app.post("/api/auth/login")
    async def login(payload: LoginInput, request: Request, response: Response):
        limiter.check("login:" + request.client.host, 10)
        try:
            profile = await asyncio.to_thread(
                auth.authenticate, settings, payload.username, payload.password
            )
        except auth.AuthenticationFailed as exc:
            raise HTTPException(401, "ユーザー名またはパスワードが正しくありません") from exc
        except auth.DirectoryUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        return set_login(response, profile, request)

    @app.post("/api/auth/demo")
    def demo(request: Request, response: Response):
        if not settings.morse_demo_enabled:
            raise HTTPException(404, "体験モードは無効です")
        limiter.check("demo:" + request.client.host, 10)
        return set_login(
            response,
            {
                "id": "demo:" + secrets.token_hex(16),
                "username": "trainee",
                "display_name": "体験訓練生",
                "demo": True,
            },
            request,
        )

    @app.get("/api/auth/me")
    def me(user=Depends(current_user)):
        return user

    @app.post("/api/auth/logout", status_code=204)
    def logout(request: Request, response: Response):
        database.logout(request.cookies.get(COOKIE, ""))
        response.delete_cookie(
            COOKIE, httponly=True, samesite="strict", secure=settings.morse_cookie_secure
        )

    @app.get("/api/preferences")
    def preferences(user=Depends(current_user)):
        return database.preferences(user["id"])

    @app.put("/api/preferences")
    def save_preferences(payload: Preferences, user=Depends(current_user)):
        return database.preferences(user["id"], payload.model_dump())

    @app.post("/api/onboarding/seen")
    def dismiss_onboarding(user=Depends(current_user)):
        return database.preferences(user["id"], {"onboarding_seen": True})

    @app.get("/api/stats")
    def stats(user=Depends(current_user)):
        return database.stats(user["id"])

    @app.post("/api/exercises/next")
    def next_exercise(mode: Mode = "send", user=Depends(current_user)):
        limiter.check("exercise:" + user["id"], 60)
        exercise = make_exercise(mode, database.preferences(user["id"]), database.stats(user["id"]))
        database.save_exercise(user["id"], exercise)
        return public_exercise(exercise)

    @app.post("/api/attempts")
    def attempt(payload: Attempt, user=Depends(current_user)):
        exercise = database.exercise(user["id"], payload.exercise_id)
        if not exercise:
            raise HTTPException(
                404, "課題が見つからないか、有効期限が切れています。次の課題へ進んでください。"
            )
        try:
            result = grade(exercise, payload)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return database.record(user["id"], result)

    @app.get("/api/coach/status")
    def coach_status(user=Depends(current_user)):
        return app.state.coach.status()

    @app.post("/api/coach")
    async def run_coach(payload: RunAgentInput, user=Depends(current_user)):
        limiter.check("coach:" + user["id"], 12)
        if user["id"] in app.state.coaching_users:
            raise HTTPException(409, "コーチの応答を待ってから次の相談を送ってください。")
        if not payload.messages or len(payload.messages) > 200:
            raise HTTPException(422, "相談内容を入力してください")
        dialogue = []
        for message in payload.messages[-10:]:
            content = getattr(message, "content", None)
            if message.role in ("user", "assistant") and isinstance(content, str):
                dialogue.append({"role": message.role, "content": content[:4000]})
        if not dialogue or dialogue[-1]["role"] != "user":
            raise HTTPException(422, "相談内容を入力してください")
        statistics = database.stats(user["id"])
        # Identity and authentication details never enter the model context.
        observation = {
            "preferences": database.preferences(user["id"]),
            "last_results": statistics["recent"][:3],
            "weaknesses": statistics["weaknesses"],
        }
        context = [
            {"description": c.description[:100], "value": c.value[:3000]}
            for c in payload.context[:3]
        ]
        prompt = json.dumps(
            {"training": observation, "live_observation": context, "conversation": dialogue},
            ensure_ascii=False,
        )
        app.state.coaching_users.add(user["id"])

        async def events():
            def event(kind, **data):
                return "data: " + json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n\n"

            message_id = str(uuid.uuid4())
            try:
                yield event("RUN_STARTED", threadId=payload.thread_id, runId=payload.run_id)
                yield event("TEXT_MESSAGE_START", messageId=message_id, role="assistant")
                async with aclosing(app.state.coach.stream(prompt)) as stream:
                    async for delta in stream:
                        yield event("TEXT_MESSAGE_CONTENT", messageId=message_id, delta=delta)
                yield event("TEXT_MESSAGE_END", messageId=message_id)
                yield event("RUN_FINISHED", threadId=payload.thread_id, runId=payload.run_id)
            except CoachUnavailable as exc:
                yield event("RUN_ERROR", message=str(exc), code="COACH_UNAVAILABLE")
            except Exception as exc:
                logger.error("Coach stream failed: %s", type(exc).__name__)
                yield event(
                    "RUN_ERROR",
                    message="コーチとの接続に失敗しました。もう一度お試しください。",
                    code="COACH_ERROR",
                )
            finally:
                app.state.coaching_users.discard(user["id"])

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
        )

    distribution = ROOT / "frontend/dist"
    if (distribution / "assets").exists():
        app.mount("/assets", StaticFiles(directory=distribution / "assets"), name="assets")

    @app.get("/{path:path}")
    def index(path: str):
        if path.startswith("api/") or path == "api":
            raise HTTPException(404, "APIが見つかりません")
        if not (distribution / "index.html").exists():
            raise HTTPException(503, "フロントエンドを pnpm build でビルドしてください")
        return FileResponse(distribution / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
