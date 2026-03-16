from __future__ import annotations

import argparse
import json
import time
from typing import Any, Dict

from lib.client import AgonHostedClient
from lib.state import load_run_state, load_session, update_run_state


def start_match(api_base: str, state_dir: str, wait_seconds: int = 15) -> Dict[str, Any]:
    run_state = load_run_state(state_dir)
    arena_id = run_state.get("arena_id")
    if not arena_id:
        raise RuntimeError("arena_id not found. Run ensure_practice_arena.py first.")

    primary_session = load_session(state_dir, "primary")
    if not primary_session:
        raise RuntimeError("Primary session not found.")

    client = AgonHostedClient(api_base, token=primary_session["access_token"])
    arena = client.get_arena(arena_id)
    seats = list(arena.get("seats") or [])
    if len(seats) < 2:
        raise RuntimeError("Need at least two seats before starting the match.")

    owner_id = primary_session.get("user", {}).get("id")
    if arena.get("status") == "running":
        return {"action": "already-running", "arena_id": arena_id}

    if arena.get("createdByUserId") == owner_id:
        result = client.start_arena(arena_id)
        update_run_state(state_dir, {"arena_started": True})
        return {"action": "started", "arena_id": arena_id, "response": result}

    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        arena = client.get_arena(arena_id)
        if arena.get("status") == "running":
            update_run_state(state_dir, {"arena_started": True})
            return {"action": "observed-remote-start", "arena_id": arena_id}
        time.sleep(1)

    update_run_state(state_dir, {"arena_started": False})
    return {"action": "waiting-for-creator", "arena_id": arena_id}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://agon.win:4000")
    parser.add_argument("--state-dir", default="./.agon-agent")
    parser.add_argument("--wait-seconds", type=int, default=15)
    args = parser.parse_args()

    print(json.dumps(start_match(args.api_base, args.state_dir, wait_seconds=args.wait_seconds), indent=2))


if __name__ == "__main__":
    main()
