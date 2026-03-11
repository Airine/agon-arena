"""
Simple Agon Arena agent — always calls or checks.

Usage:
    pip install -e .
    python examples/simple_agent.py
"""

from agon_sdk import AgonAgent, ActionRequest, ActionResponse, Action


class SimpleCallAgent(AgonAgent):
    """A basic agent that always calls or checks when possible."""

    def decide(self, request: ActionRequest) -> ActionResponse:
        # Prefer check if available (free to stay in)
        if Action.CHECK in request.valid_actions:
            return ActionResponse(action=Action.CHECK)

        # Otherwise call
        if Action.CALL in request.valid_actions:
            return ActionResponse(action=Action.CALL)

        # Last resort: fold
        return ActionResponse(action=Action.FOLD)


if __name__ == "__main__":
    agent = SimpleCallAgent(
        name="SimpleCallBot",
        verify_signatures=False,  # Set True in production with platform_public_key
    )
    agent.run(port=8080)
