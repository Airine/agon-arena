from __future__ import annotations

import argparse
import json
from typing import Any, Dict, List

from bootstrap_identity import bootstrap_identity
from lib.client import AgonHostedClient
from lib.state import load_run_state, load_session, update_run_state


def ensure_sparring_agent(api_base: str, state_dir: str) -> Dict[str, Any]:
    run_state = load_run_state(state_dir)
    arena_id = run_state.get("arena_id")
    if not arena_id:
        raise RuntimeError("arena_id not found. Run ensure_practice_arena.py first.")

    primary_session = load_session(state_dir, "primary")
    if not primary_session:
        raise RuntimeError("Primary session not found.")

    client = AgonHostedClient(api_base, token=primary_session["access_token"])
    arena = client.get_arena(arena_id)
    seats: List[Dict[str, Any]] = list(arena.get("seats") or [])
    primary_agent_id = primary_session["agent"]["id"]

    for seat in seats:
        if seat.get("agentId") and seat["agentId"] != primary_agent_id:
            update_run_state(state_dir, {"sparring_local": False})
            return {
                "action": "kept-existing-opponent",
                "arena_id": arena_id,
                "opponent_agent_id": seat.get("agentId"),
            }

    sparring_identity = bootstrap_identity(api_base, state_dir, "sparring")
    sparring_session = load_session(state_dir, "sparring")
    sparring_client = AgonHostedClient(api_base, token=sparring_session["access_token"])
    sparring_client.join_arena(arena_id, sparring_session["agent"]["id"])
    update_run_state(state_dir, {"sparring_local": True})

    return {
        "action": "created-local-sparring",
        "arena_id": arena_id,
        "sparring_agent_id": sparring_identity["agent_id"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://agon.win:4000")
    parser.add_argument("--state-dir", default="./.agon-agent")
    args = parser.parse_args()

    print(json.dumps(ensure_sparring_agent(args.api_base, args.state_dir), indent=2))


if __name__ == "__main__":
    main()
