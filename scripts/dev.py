"""Run Vite publicly and FastAPI on loopback, terminating both on exit."""

import signal
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
processes = []


def stop(*_):
    for process in processes:
        process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    raise SystemExit


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    processes.append(
        subprocess.Popen(
            [
                "uv",
                "run",
                "uvicorn",
                "backend.app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "17631",
                "--reload",
                "--reload-dir",
                "backend",
            ],
            cwd=ROOT,
        )
    )
    processes.append(
        subprocess.Popen(["pnpm", "exec", "vite", "--config", "frontend/vite.config.ts"], cwd=ROOT)
    )
    while all(process.poll() is None for process in processes):
        time.sleep(0.3)
finally:
    stop()
