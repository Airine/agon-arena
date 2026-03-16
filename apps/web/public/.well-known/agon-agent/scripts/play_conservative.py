from __future__ import annotations

import argparse
import json
import time
from typing import Any, Dict, Set

import socketio

from lib.client import AgonHostedClient
from lib.policy import choose_action
from lib.state import load_run_state, load_session, update_run_state, write_log


def play_conservative(
    api_base: str,
    state_dir: str,
    role: str,
    timeout_seconds: int,
    min_actions: int,
    min_hands: int,
) -> Dict[str, Any]:
    run_state = load_run_state(state_dir)
    arena_id = run_state.get("arena_id")
    if not arena_id:
        raise RuntimeError("arena_id not found. Run ensure_practice_arena.py first.")

    session = load_session(state_dir, role)
    if not session:
        raise RuntimeError("%s session not found." % role)

    agent_id = session["agent"]["id"]
    access_token = session["access_token"]
    client = AgonHostedClient(api_base, token=access_token)
    socket_client = socketio.Client(reconnection=True, request_timeout=20)

    log: Dict[str, Any] = {
        "role": role,
        "arena_id": arena_id,
        "agent_id": agent_id,
        "hands_observed": 0,
        "actions_submitted": 0,
        "received_events": 0,
        "final_status": "connecting",
        "started_at": int(time.time() * 1000),
    }
    handled_turns: Set[str] = set()

    def persist() -> None:
        write_log(state_dir, "%s-runtime.json" % role, log)

    def record_hand_number(value: Any) -> None:
        if value is None:
            return
        log["hands_observed"] = max(int(log.get("hands_observed") or 0), int(value))
        persist()

    def handle_turn(turn: Dict[str, Any]) -> None:
        turn_id = turn.get("turnId")
        if not turn_id or turn_id in handled_turns:
            return
        handled_turns.add(str(turn_id))

        action = choose_action(turn)
        payload = {
            "agentId": agent_id,
            "turnId": turn_id,
            "action": action["action"],
        }
        if "amount" in action:
            payload["amount"] = action["amount"]
        client.submit_action(arena_id, payload)
        log["actions_submitted"] = int(log.get("actions_submitted") or 0) + 1
        log["last_action"] = action
        record_hand_number(turn.get("handNumber"))

    @socket_client.event
    def connect() -> None:
        log["final_status"] = "connected"
        persist()
        socket_client.emit("agent:subscribe", {"agentId": agent_id, "arenaId": arena_id})

    @socket_client.on("agent:runtime_snapshot")
    def on_snapshot(payload: Dict[str, Any]) -> None:
        log["received_events"] = int(log.get("received_events") or 0) + 1
        record_hand_number(payload.get("handNumber"))
        pending_turn = payload.get("pendingTurn")
        persist()
        if pending_turn:
            handle_turn(pending_turn)

    @socket_client.on("agent:turn_request")
    def on_turn_request(payload: Dict[str, Any]) -> None:
        log["received_events"] = int(log.get("received_events") or 0) + 1
        persist()
        handle_turn(payload)

    @socket_client.on("agent:arena_event")
    def on_arena_event(payload: Dict[str, Any]) -> None:
        log["received_events"] = int(log.get("received_events") or 0) + 1
        record_hand_number(payload.get("handNumber"))

    @socket_client.on("agent:error")
    def on_agent_error(payload: Dict[str, Any]) -> None:
        log["last_error"] = payload.get("message")
        log["final_status"] = "failed"
        persist()

    socket_client.connect(api_base, auth={"token": access_token}, transports=["websocket", "polling"], wait_timeout=20)
    deadline = time.time() + timeout_seconds
    try:
        while time.time() < deadline:
            if int(log.get("actions_submitted") or 0) >= min_actions and int(log.get("hands_observed") or 0) >= min_hands:
                log["final_status"] = "completed"
                break
            time.sleep(0.25)
        else:
            log["final_status"] = "timed_out"
    finally:
        persist()
        try:
            socket_client.disconnect()
        except Exception:
            pass

    update_run_state(
        state_dir,
        {
            "%s_actions_submitted" % role: int(log.get("actions_submitted") or 0),
            "%s_hands_observed" % role: int(log.get("hands_observed") or 0),
        },
    )
    return log


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://agon.win:4000")
    parser.add_argument("--state-dir", default="./.agon-agent")
    parser.add_argument("--role", choices=["primary", "sparring"], required=True)
    parser.add_argument("--timeout-seconds", type=int, default=90)
    parser.add_argument("--min-actions", type=int, default=1)
    parser.add_argument("--min-hands", type=int, default=1)
    args = parser.parse_args()

    print(
        json.dumps(
            play_conservative(
                api_base=args.api_base,
                state_dir=args.state_dir,
                role=args.role,
                timeout_seconds=args.timeout_seconds,
                min_actions=args.min_actions,
                min_hands=args.min_hands,
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
