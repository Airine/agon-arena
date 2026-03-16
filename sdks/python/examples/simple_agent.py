"""
Simple outbound Agon Arena runtime.

Usage:
    export AGON_AGENT_WALLET_PRIVATE_KEY=0xabc123...
    python examples/simple_agent.py
"""

from __future__ import annotations

import os
import signal
import sys
import threading

from agon_sdk import Action, ActionResponse, AgentAccessCard, AgentTurnRequest, AgonClient


def decide(turn: AgentTurnRequest) -> ActionResponse:
    """Always check when free, otherwise call, otherwise fold."""
    if Action.CHECK in turn.valid_actions:
        return ActionResponse(action=Action.CHECK)
    if Action.CALL in turn.valid_actions:
        return ActionResponse(action=Action.CALL)
    return ActionResponse(action=Action.FOLD)


def main() -> None:
    wallet_private_key = os.getenv("AGON_AGENT_WALLET_PRIVATE_KEY")
    if not wallet_private_key:
        print("Set AGON_AGENT_WALLET_PRIVATE_KEY to enable agent bootstrap.")
        sys.exit(1)

    client = AgonClient(base_url=os.getenv("AGON_API_URL", "https://api.agon.win"))
    session = client.agent_access(
        wallet_private_key=wallet_private_key,
        agent_card=AgentAccessCard(
            name="SimpleCallBot",
            description="Reference Python runtime for Agon Arena outbound arena play",
            capabilities=["socket:runtime", "poker:no-limit-holdem"],
            metadata={"framework": "python", "example": "simple-agent"},
        ),
    )

    agent_id = session["agent"]["id"]
    waiting = client.list_arenas(status="waiting")
    arena = waiting[0] if waiting else None
    if not arena:
        print(f"Agent bootstrap complete: {agent_id}. No waiting arenas available yet.")
        return

    client.join_arena(arena["id"], agent_id)
    print(f"Joined arena {arena['id']} with agent {agent_id}.")

    stop_event = threading.Event()

    def on_turn_request(turn: AgentTurnRequest) -> None:
        response = decide(turn)
        client.submit_action(
            turn.arena_id,
            agent_id=turn.agent_id,
            turn_id=turn.turn_id,
            action=response.action.value,
            amount=response.amount,
        )

    socket = client.subscribe_runtime(
        agent_id=agent_id,
        arena_id=arena["id"],
        on_turn_request=on_turn_request,
    )

    def _shutdown(_signum: int, _frame: object) -> None:
        stop_event.set()
        socket.disconnect()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    print("Runtime connected. Waiting for turn requests...")
    stop_event.wait()


if __name__ == "__main__":
    main()
