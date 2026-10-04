"""A small local supervisor for the single-port production build."""

import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.config import Settings  # noqa: E402

settings = Settings()
runtime = ROOT / ".local"
runtime.mkdir(exist_ok=True, mode=0o700)
pidfile = runtime / "server.pid"


def running_pid():
    if not pidfile.exists():
        return None
    pid = int(pidfile.read_text())
    try:
        # Verify process identity before stopping a PID that might have been reused.
        command = Path(f"/proc/{pid}/cmdline").read_bytes()
        cwd = Path(f"/proc/{pid}/cwd").resolve()
        if b"backend.app.main:app" in command and cwd == ROOT:
            return pid
    except (OSError, ValueError):
        return None
    return None


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    pid = running_pid()
    if action == "status":
        print(f"稼働中 PID={pid} / ポート {settings.morse_port}" if pid else "停止中")
    elif action == "stop":
        if pid:
            os.kill(pid, signal.SIGTERM)
            for _ in range(50):
                if not running_pid():
                    break
                time.sleep(0.1)
            else:
                raise SystemExit("停止処理が続いています。ログを確認してください。")
        pidfile.unlink(missing_ok=True)
        print("停止しました")
    elif action == "start":
        if pid:
            print(f"すでに稼働中です PID={pid}")
            return
        if not (ROOT / "frontend/dist/index.html").exists():
            raise SystemExit("先に pnpm build を実行してください")
        with (runtime / "server.log").open("ab") as log:
            process = subprocess.Popen(
                [
                    str(ROOT / ".venv/bin/python"),
                    "-m",
                    "uvicorn",
                    "backend.app.main:app",
                    "--host",
                    settings.morse_host,
                    "--port",
                    str(settings.morse_port),
                    "--no-proxy-headers",
                ],
                cwd=ROOT,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                start_new_session=True,
            )
        pidfile.write_text(str(process.pid))
        for _ in range(50):
            if process.poll() is not None:
                pidfile.unlink(missing_ok=True)
                raise SystemExit("起動に失敗しました。.local/server.log を確認してください。")
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{settings.morse_port}/api/health", timeout=1
                ) as response:
                    if response.status == 200:
                        time.sleep(0.2)
                        if process.poll() is None:
                            print(
                                f"起動しました http://localhost:{settings.morse_port} / PID={process.pid}"
                            )
                            return
            except (urllib.error.URLError, TimeoutError):
                pass
            time.sleep(0.1)
        process.terminate()
        pidfile.unlink(missing_ok=True)
        raise SystemExit("起動確認がタイムアウトしました。.local/server.log を確認してください。")
    else:
        raise SystemExit("usage: manage.py start|stop|status")


if __name__ == "__main__":
    main()
