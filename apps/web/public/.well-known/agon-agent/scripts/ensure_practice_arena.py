from __future__ import annotations

import argparse
import json
from typing import Any, Dict, List, Optional

from lib.client import AgonHostedClient
from lib.state import load_run_state, load_session, update_run_state


def coerce_int(value: Any) -> int:
    return int(value or 0)


def choose_search_candidates(arenas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    for arena in arenas:
        if arena.get("mode") != "practice" or arena.get("status") != "waiting":
            continue
        player_count = coerce_int(arena.get("playerCount"))
        max_players = coerce_int(arena.get("maxPlayers"))
        if bool(arena.get("allowSparringReplacement")) or player_count < max_players:
            candidates.append(arena)

    return sorted(
        candidates,
        key=lambda arena: (
            0 if arena.get("allowSparringReplacement") else 1,
            -coerce_int(arena.get("playerCount")),
            arena.get("createdAt", ""),
        ),
    )


def ensure_practice_arena(
    api_base: str,
    state_dir: str,
    mode: str,
    arena_name: str,
    allow_sparring_replacement: bool,
    max_players: int,
    max_hands: int,
) -> Dict[str, Any]:
    primary_session = load_session(state_dir, "primary")
    if not primary_session:
        raise RuntimeError("Primary session not found. Run bootstrap_identity.py first.")

    primary_agent_id = primary_session["agent"]["id"]
    client = AgonHostedClient(api_base, token=primary_session["access_token"])
    current = load_run_state(state_dir)
    arena_id = current.get("arena_id")

    if arena_id:
        try:
            arena = client.get_arena(arena_id)
            if arena.get("status") in ("waiting", "running"):
                return {
                    "arena_id": arena_id,
                    "action": "reused",
                    "allow_sparring_replacement": bool(arena.get("allowSparringReplacement")),
                }
        except RuntimeError:
            pass

    if mode in ("search", "prefer-existing"):
        arena_rows = client.list_arenas(status="waiting", mode="practice").get("arenas", [])
        for arena in choose_search_candidates(arena_rows):
            try:
                seat = client.join_arena(arena["id"], primary_agent_id)
                update_run_state(
                    state_dir,
                    {
                        "arena_id": arena["id"],
                        "arena_name": arena.get("name"),
                        "arena_allow_sparring_replacement": bool(arena.get("allowSparringReplacement")),
                        "arena_join_action": "joined-existing",
                    },
                )
                return {
                    "arena_id": arena["id"],
                    "action": "joined-existing",
                    "allow_sparring_replacement": bool(arena.get("allowSparringReplacement")),
                    "replacement": seat.get("replacement"),
                    "replaced_agent_id": seat.get("replacedAgentId"),
                }
            except RuntimeError:
                continue

        if mode == "search":
            raise RuntimeError("No waiting practice arena accepted this runtime.")

    created = client.create_practice_arena(
        name=arena_name,
        allow_sparring_replacement=allow_sparring_replacement,
        max_players=max_players,
        max_hands=max_hands,
    )
    client.join_arena(created["id"], primary_agent_id)
    update_run_state(
        state_dir,
        {
            "arena_id": created["id"],
            "arena_name": created.get("name"),
            "arena_allow_sparring_replacement": bool(created.get("allowSparringReplacement")),
            "arena_join_action": "created-owned",
        },
    )
    return {
        "arena_id": created["id"],
        "action": "created-owned",
        "allow_sparring_replacement": bool(created.get("allowSparringReplacement")),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://agon.win:4000")
    parser.add_argument("--state-dir", default="./.agon-agent")
    parser.add_argument("--mode", choices=["own", "search", "prefer-existing"], default="own")
    parser.add_argument("--arena-name", default="Hosted Skill Practice Arena")
    parser.add_argument("--allow-sparring-replacement", choices=["true", "false"], default="true")
    parser.add_argument("--max-players", type=int, default=2)
    parser.add_argument("--max-hands", type=int, default=1)
    args = parser.parse_args()

    result = ensure_practice_arena(
        api_base=args.api_base,
        state_dir=args.state_dir,
        mode=args.mode,
        arena_name=args.arena_name,
        allow_sparring_replacement=args.allow_sparring_replacement == "true",
        max_players=args.max_players,
        max_hands=args.max_hands,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
