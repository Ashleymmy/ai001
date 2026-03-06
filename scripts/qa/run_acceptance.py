#!/usr/bin/env python3
"""One-click acceptance checks for AI Storyboarder.

Default checks:
1) Frontend production build
2) Backend syntax compile check
3) Backend studio test suite
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Sequence


def run(cmd: Sequence[str], cwd: Path) -> int:
    print(f"\n[RUN] {' '.join(cmd)}", flush=True)
    proc = subprocess.run(cmd, cwd=str(cwd))
    print(f"[EXIT] {proc.returncode}", flush=True)
    return int(proc.returncode)


def require_cmd(name: str) -> bool:
    if shutil.which(name):
        return True
    print(f"[ERROR] Missing required command: {name}", flush=True)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Run project acceptance checks.")
    parser.add_argument(
        "--install-backend-deps",
        action="store_true",
        help="Install backend requirements before running checks.",
    )
    parser.add_argument(
        "--skip-frontend-build",
        action="store_true",
        help="Skip npm run build.",
    )
    parser.add_argument(
        "--skip-backend-compile",
        action="store_true",
        help="Skip python -m compileall backend.",
    )
    parser.add_argument(
        "--skip-backend-tests",
        action="store_true",
        help="Skip python -m pytest -q backend/services/studio/tests.",
    )
    parser.add_argument(
        "--pytest-path",
        default="backend/services/studio/tests",
        help="Path passed to pytest. Default: backend/services/studio/tests",
    )
    parser.add_argument(
        "--queue-smoke",
        action="store_true",
        help="Run extra queue smoke tests after default checks.",
    )
    parser.add_argument(
        "--ui-v2-smoke",
        action="store_true",
        help="Run lightweight frontend migration smoke checks for Agent/Studio v2.",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent
    python_cmd = sys.executable

    print("[INFO] AI Storyboarder acceptance checks", flush=True)
    print(f"[INFO] repo_root={repo_root}", flush=True)
    print(f"[INFO] python={python_cmd}", flush=True)

    if not require_cmd("npm"):
        return 1

    failures: list[str] = []

    if args.install_backend_deps:
        code = run(
            [python_cmd, "-m", "pip", "install", "-r", "backend/requirements.txt"],
            cwd=repo_root,
        )
        if code != 0:
            failures.append("install-backend-deps")

    if not args.skip_frontend_build:
        code = run(["npm", "run", "build"], cwd=repo_root)
        if code != 0:
            failures.append("frontend-build")

    if not args.skip_backend_compile:
        code = run([python_cmd, "-m", "compileall", "backend"], cwd=repo_root)
        if code != 0:
            failures.append("backend-compile")

    if not args.skip_backend_tests:
        code = run([python_cmd, "-m", "pytest", "-q", args.pytest_path], cwd=repo_root)
        if code != 0:
            failures.append("backend-tests")
            print(
                "[HINT] If pytest is missing, run with --install-backend-deps "
                "or install backend requirements manually.",
                flush=True,
            )

    if args.queue_smoke:
        code = run(
            [python_cmd, "-m", "pytest", "-q", "backend/services/studio/tests/test_task_queue_storage.py"],
            cwd=repo_root,
        )
        if code != 0:
            failures.append("queue-smoke")

    if args.ui_v2_smoke:
        print("\n[RUN] ui-v2 smoke checks", flush=True)
        app_tsx = repo_root / "src" / "App.tsx"
        home_tsx = repo_root / "src" / "pages" / "HomePage.tsx"
        required_paths = [
            repo_root / "src" / "pages" / "AgentPageV2.tsx",
            repo_root / "src" / "pages" / "StudioPageV2.tsx",
            repo_root / "src" / "components" / "ui-v2" / "CapsuleNav.tsx",
            repo_root / "src" / "components" / "ui-v2" / "LLMStageStreamCard.tsx",
            repo_root / "src" / "features" / "stream" / "streamEventBridge.ts",
        ]
        missing = [str(p.relative_to(repo_root)) for p in required_paths if not p.exists()]
        if missing:
            print(f"[ERROR] Missing ui-v2 files: {', '.join(missing)}", flush=True)
            failures.append("ui-v2-smoke")
        else:
            app_text = app_tsx.read_text(encoding="utf-8", errors="ignore")
            home_text = home_tsx.read_text(encoding="utf-8", errors="ignore")
            route_ok = (
                ("agent-v2" in app_text)
                and ("studio-v2" in app_text)
                and ("AgentPageV2" in app_text)
                and ("StudioPageV2" in app_text)
            )
            home_ok = "Agent v2 Beta" in home_text and "Studio v2 Beta" in home_text
            if not route_ok or not home_ok:
                print("[ERROR] ui-v2 routes or home beta entries are missing", flush=True)
                failures.append("ui-v2-smoke")
            else:
                print("[EXIT] 0", flush=True)

    print("\n[SUMMARY]", flush=True)
    if failures:
        print(f"[FAIL] {len(failures)} check(s) failed: {', '.join(failures)}", flush=True)
        return 1
    print("[PASS] All selected checks passed.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
