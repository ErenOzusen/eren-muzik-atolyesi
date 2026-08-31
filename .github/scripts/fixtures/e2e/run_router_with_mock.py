#!/usr/bin/env python3
"""E2E test helper — runs the REAL, unmodified ai_router.py main() with only
its request_json (the literal network call) replaced by a canned response
queue. This is the exact same unittest.mock.patch.object(ai_router,
"request_json", ...) boundary test_ai_router.py and
test_router_cost_guard_integration_scenarios.py already use and this
project's own test suite already trusts as "real code path, zero network"
— reused here to drive test_zero_token_full_e2e.mjs's pipeline stages.

Never makes a real network call: request_json is patched out entirely, so
even a bug in this script can only ever fail loudly (queue exhausted /
import error), never silently reach a real provider.

Usage:
  run_router_with_mock.py --responses-file <path> <...normal ai_router.py args...>

--responses-file points at a JSON array of [http_status, response_body]
pairs (response_body being the exact dict ai_router.py's call_anthropic /
call_openai_chat expect back from request_json), consumed in order — one
per real provider attempt the router loop makes.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[2]
ROUTER_PATH = SCRIPTS_DIR / "ai_router.py"


def load_ai_router():
    # ai_router.py does `from output_contract import ...` — a same-directory
    # import that only resolves automatically when it's run directly as the
    # main script (Python then puts its own directory on sys.path[0]).
    # Loading it via importlib from a different directory (this fixture
    # helper lives under fixtures/e2e/) does not get that for free.
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    spec = importlib.util.spec_from_file_location("ai_router_e2e", ROUTER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {ROUTER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    args = sys.argv[1:]
    responses_file: str | None = None
    passthrough: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == "--responses-file":
            responses_file = args[i + 1]
            i += 2
        else:
            passthrough.append(args[i])
            i += 1

    if not responses_file:
        raise SystemExit("run_router_with_mock.py: --responses-file is required")

    queue: list[list[Any]] = json.loads(Path(responses_file).read_text(encoding="utf-8"))
    ai_router = load_ai_router()

    def fake_request_json(url: str, headers: dict, payload: dict, timeout: int):
        if not queue:
            raise RuntimeError("run_router_with_mock.py: response queue exhausted — more provider attempts than fixtures provided")
        status, body = queue.pop(0)
        return status, body

    with patch.object(ai_router, "request_json", side_effect=fake_request_json):
        sys.argv = ["ai_router.py", *passthrough]
        ai_router.main()


if __name__ == "__main__":
    main()
