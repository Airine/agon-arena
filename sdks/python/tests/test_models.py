"""Tests for Agon SDK models."""

from agon_sdk.models import (
    Action,
    ActionRequest,
    ActionResponse,
    AgentAccessCard,
    AgentRegistration,
    Card,
    GameState,
    PlayerState,
    Rank,
    Suit,
)


def test_card_str():
    card = Card(rank=Rank.ACE, suit=Suit.SPADES)
    assert str(card) == "As"


def test_action_response_fold():
    resp = ActionResponse(action=Action.FOLD)
    assert resp.action == Action.FOLD
    assert resp.amount is None


def test_action_response_raise():
    resp = ActionResponse(action=Action.RAISE, amount=100)
    assert resp.action == Action.RAISE
    assert resp.amount == 100


def test_action_request_parse():
    data = {
        "game_id": "abc-123",
        "hand_id": "hand-1",
        "state": {
            "phase": "pre_flop",
            "pot": 30,
            "community_cards": [],
            "hole_cards": [
                {"rank": "A", "suit": "s"},
                {"rank": "K", "suit": "s"},
            ],
            "players": [
                {
                    "agent_id": "a1",
                    "agent_name": "Bot1",
                    "seat_index": 0,
                    "stack": 980,
                    "bet": 20,
                },
                {
                    "agent_id": "a2",
                    "agent_name": "Bot2",
                    "seat_index": 1,
                    "stack": 990,
                    "bet": 10,
                },
            ],
            "current_bet": 20,
            "min_raise": 40,
            "dealer_index": 0,
            "hand_number": 1,
        },
        "valid_actions": ["fold", "call", "raise"],
        "timeout_ms": 5000,
    }
    req = ActionRequest(**data)
    assert req.game_id == "abc-123"
    assert len(req.state.hole_cards) == 2
    assert req.state.hole_cards[0].rank == Rank.ACE
    assert req.valid_actions == [Action.FOLD, Action.CALL, Action.RAISE]


def test_agent_registration_validation():
    reg = AgentRegistration(
        name="TestBot",
        metadata={"framework": "python"},
    )
    assert reg.version == "1.0"
    assert reg.metadata == {"framework": "python"}


def test_agent_access_card_defaults():
    card = AgentAccessCard(
        name="SkillBot",
    )
    assert card.version == "1.0"
    assert card.capabilities == []


def test_game_state_with_community_cards():
    state = GameState(
        phase="flop",
        pot=100,
        community_cards=[
            Card(rank=Rank.TEN, suit=Suit.HEARTS),
            Card(rank=Rank.JACK, suit=Suit.HEARTS),
            Card(rank=Rank.QUEEN, suit=Suit.HEARTS),
        ],
        hole_cards=[
            Card(rank=Rank.ACE, suit=Suit.HEARTS),
            Card(rank=Rank.KING, suit=Suit.HEARTS),
        ],
        players=[
            PlayerState(agent_id="a1", agent_name="Bot1", seat_index=0, stack=900),
        ],
        current_bet=0,
        min_raise=20,
        dealer_index=0,
        hand_number=5,
    )
    assert len(state.community_cards) == 3
    assert state.phase == "flop"
