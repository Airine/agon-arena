"""
Smarter Agon Arena agent — uses hand strength to decide.

Usage:
    pip install -e .
    python examples/smart_agent.py
"""

import random

from agon_sdk import AgonAgent, ActionRequest, ActionResponse, Action, Card, HandRank


# Simple hand strength heuristic based on hole cards
HIGH_RANKS = {"A", "K", "Q", "J", "T"}
PREMIUM_PAIRS = {"A", "K", "Q"}


def evaluate_hole_cards(cards: list[Card]) -> float:
    """Return a score 0.0-1.0 based on hole card strength."""
    if len(cards) != 2:
        return 0.3

    r1, r2 = cards[0].rank.value, cards[1].rank.value
    suited = cards[0].suit == cards[1].suit

    # Pocket pair
    if r1 == r2:
        if r1 in PREMIUM_PAIRS:
            return 0.95
        if r1 in HIGH_RANKS:
            return 0.85
        return 0.7

    # Both high cards
    if r1 in HIGH_RANKS and r2 in HIGH_RANKS:
        return 0.8 if suited else 0.7

    # One high card
    if r1 in HIGH_RANKS or r2 in HIGH_RANKS:
        return 0.55 if suited else 0.45

    # Suited connectors
    if suited:
        return 0.4

    return 0.25


class SmartAgent(AgonAgent):
    """An agent that uses hand strength to make decisions."""

    def decide(self, request: ActionRequest) -> ActionResponse:
        strength = evaluate_hole_cards(request.state.hole_cards)
        pot = request.state.pot
        call_cost = request.state.current_bet
        stack = 0

        # Find our stack
        for p in request.state.players:
            if not p.is_folded:
                stack = max(stack, p.stack)

        # Strong hand: raise
        if strength > 0.8 and Action.RAISE in request.valid_actions:
            raise_amount = max(request.state.min_raise, pot // 2)
            return ActionResponse(action=Action.RAISE, amount=raise_amount)

        # Decent hand: call
        if strength > 0.4:
            if Action.CHECK in request.valid_actions:
                return ActionResponse(action=Action.CHECK)
            if Action.CALL in request.valid_actions:
                # Don't call if it's too expensive relative to our stack
                if call_cost < stack * 0.3:
                    return ActionResponse(action=Action.CALL)

        # Weak hand: occasionally bluff (10% of the time)
        if random.random() < 0.1 and Action.RAISE in request.valid_actions:
            return ActionResponse(
                action=Action.RAISE, amount=request.state.min_raise
            )

        # Check if free
        if Action.CHECK in request.valid_actions:
            return ActionResponse(action=Action.CHECK)

        return ActionResponse(action=Action.FOLD)


if __name__ == "__main__":
    agent = SmartAgent(
        name="SmartBot",
        verify_signatures=False,
    )
    agent.run(port=8080)
