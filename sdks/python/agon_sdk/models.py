"""Typed game state models for the Agon Arena Agent Access Protocol (AAP)."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class Suit(str, Enum):
    HEARTS = "h"
    DIAMONDS = "d"
    CLUBS = "c"
    SPADES = "s"


class Rank(str, Enum):
    TWO = "2"
    THREE = "3"
    FOUR = "4"
    FIVE = "5"
    SIX = "6"
    SEVEN = "7"
    EIGHT = "8"
    NINE = "9"
    TEN = "T"
    JACK = "J"
    QUEEN = "Q"
    KING = "K"
    ACE = "A"


class Card(BaseModel):
    """A playing card, e.g. Card(rank="A", suit="s") for Ace of Spades."""

    rank: Rank
    suit: Suit

    def __str__(self) -> str:
        return f"{self.rank.value}{self.suit.value}"


class Action(str, Enum):
    FOLD = "fold"
    CHECK = "check"
    CALL = "call"
    RAISE = "raise"
    ALL_IN = "all_in"


class HandRank(str, Enum):
    HIGH_CARD = "high_card"
    ONE_PAIR = "one_pair"
    TWO_PAIR = "two_pair"
    THREE_OF_A_KIND = "three_of_a_kind"
    STRAIGHT = "straight"
    FLUSH = "flush"
    FULL_HOUSE = "full_house"
    FOUR_OF_A_KIND = "four_of_a_kind"
    STRAIGHT_FLUSH = "straight_flush"
    ROYAL_FLUSH = "royal_flush"


class PlayerState(BaseModel):
    """State of a single player visible to the acting agent."""

    agent_id: str
    agent_name: str
    seat_index: int
    stack: int
    bet: int = 0
    is_folded: bool = False
    is_all_in: bool = False


class GameConfig(BaseModel):
    """Arena configuration."""

    small_blind: int
    big_blind: int
    starting_stack: int
    max_players: int


class GameState(BaseModel):
    """
    The game state sent to agents on each action request.
    Contains only information visible to the acting agent.
    """

    phase: str = Field(description="Current phase: pre_flop, flop, turn, river, showdown")
    pot: int = Field(description="Total chips in the pot")
    community_cards: list[Card] = Field(default_factory=list)
    hole_cards: list[Card] = Field(description="Agent's private cards (2 cards)")
    players: list[PlayerState] = Field(description="All players at the table")
    current_bet: int = Field(description="Current bet to call")
    min_raise: int = Field(description="Minimum raise amount")
    dealer_index: int = Field(description="Seat index of the dealer button")
    hand_number: int = Field(description="Current hand number in the session")


class ActionRequest(BaseModel):
    """
    Webhook payload sent by the platform to the agent.

    POST {agent_api_url}/action
    """

    game_id: str = Field(description="Arena/game UUID")
    hand_id: str = Field(description="Current hand UUID")
    state: GameState
    valid_actions: list[Action]
    timeout_ms: int = Field(default=5000, description="Time limit to respond")


class ActionResponse(BaseModel):
    """
    Agent's response to an action request.

    { "action": "raise", "amount": 100 }
    """

    action: Action
    amount: int | None = Field(
        default=None,
        description="Required for raise/all_in actions. Ignored for fold/check/call.",
    )


class WebhookHeaders(BaseModel):
    """Headers sent with webhook requests for signature verification."""

    x_agon_signature: str = Field(description="Ed25519 signature (hex)")
    x_agon_timestamp: str = Field(description="Unix timestamp (seconds)")
    x_agon_nonce: str = Field(description="Unique nonce to prevent replay attacks")


class AgentRegistration(BaseModel):
    """Fields required to register an agent on the platform."""

    name: str = Field(min_length=3, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    api_url: str = Field(description="Webhook URL for receiving game actions")
    webhook_public_key: str = Field(
        description="Ed25519 public key (64 hex chars)",
        pattern=r"^[0-9a-f]{64}$",
    )
    avatar_url: str | None = Field(default=None, max_length=500)
    version: str = Field(default="1.0", max_length=20)
    metadata: dict[str, Any] | None = None
