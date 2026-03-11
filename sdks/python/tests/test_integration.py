"""
AGO-89: Python SDK integration tests.

Tests the complete lifecycle:
  1. Agent registers with the platform
  2. Agent creates an AgonAgent instance
  3. Agent's webhook server receives an action request
  4. Agent verifies the webhook signature
  5. Agent responds with a valid poker action

All HTTP calls are mocked — no live server required.
"""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, patch

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from fastapi.testclient import TestClient

from agon_sdk.models import (
    Action,
    ActionRequest,
    ActionResponse,
    Card,
    GameState,
    PlayerState,
    Rank,
    Suit,
)
from agon_sdk.server import AgonAgent
from agon_sdk.verify import verify_webhook

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def make_keypair() -> tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    """Generate a fresh Ed25519 keypair."""
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    return private_key, public_key


def public_key_hex(public_key: Ed25519PublicKey) -> str:
    """Export Ed25519 public key as 64-char hex."""
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    raw = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    return raw.hex()


def sign_webhook(
    private_key: Ed25519PrivateKey,
    body: bytes,
    timestamp: str,
    nonce: str,
) -> str:
    """Sign a webhook payload: signature over timestamp.nonce.body"""
    message = f"{timestamp}.{nonce}.".encode() + body
    sig = private_key.sign(message)
    return sig.hex()


def make_action_request(
    phase: str = "pre_flop",
    valid_actions: list[str] | None = None,
) -> ActionRequest:
    """Build a minimal but valid ActionRequest."""
    return ActionRequest(
        game_id="game-uuid-001",
        hand_id="hand-uuid-001",
        state=GameState(
            phase=phase,
            pot=150,
            community_cards=[],
            hole_cards=[
                Card(rank=Rank.ACE, suit=Suit.SPADES),
                Card(rank=Rank.KING, suit=Suit.HEARTS),
            ],
            players=[
                PlayerState(
                    agent_id="agent-001",
                    agent_name="TestBot",
                    seat_index=0,
                    stack=950,
                    bet=50,
                ),
                PlayerState(
                    agent_id="agent-002",
                    agent_name="Opponent",
                    seat_index=1,
                    stack=900,
                    bet=100,
                ),
            ],
            current_bet=100,
            min_raise=200,
            dealer_index=0,
            hand_number=1,
        ),
        valid_actions=[Action(a) for a in (valid_actions or ["fold", "call", "raise"])],
        timeout_ms=5000,
    )


# ---------------------------------------------------------------------------
# 1. Webhook signature verification — cross-language compatibility
# ---------------------------------------------------------------------------


class TestVerifyWebhook:
    """
    Tests for agon_sdk.verify.verify_webhook.

    The server signs with Ed25519 using message = f"{timestamp}.{nonce}.{body}".
    The Python SDK must correctly verify the same format.
    """

    def test_valid_signature_passes(self):
        """A correctly signed webhook is accepted."""
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        body = b'{"action":"fold"}'
        timestamp = str(int(time.time()))
        nonce = "test-nonce-001"

        sig = sign_webhook(private_key, body, timestamp, nonce)

        result = verify_webhook(
            body=body,
            signature_hex=sig,
            timestamp=timestamp,
            nonce=nonce,
            platform_public_key_hex=pub_hex,
        )
        assert result is True

    def test_invalid_signature_raises(self):
        """A forged signature raises ValueError."""
        _, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        body = b'{"action":"raise","amount":100}'
        timestamp = str(int(time.time()))
        nonce = "test-nonce-002"

        # Sign with a DIFFERENT key
        wrong_private, _ = make_keypair()
        forged_sig = sign_webhook(wrong_private, body, timestamp, nonce)

        with pytest.raises(ValueError, match="Invalid webhook signature"):
            verify_webhook(
                body=body,
                signature_hex=forged_sig,
                timestamp=timestamp,
                nonce=nonce,
                platform_public_key_hex=pub_hex,
            )

    def test_tampered_body_raises(self):
        """Tampering with the body after signing invalidates the signature."""
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        original_body = b'{"action":"call"}'
        timestamp = str(int(time.time()))
        nonce = "test-nonce-003"

        sig = sign_webhook(private_key, original_body, timestamp, nonce)

        # Attacker tampers with the body
        tampered_body = b'{"action":"raise","amount":99999}'

        with pytest.raises(ValueError, match="Invalid webhook signature"):
            verify_webhook(
                body=tampered_body,
                signature_hex=sig,
                timestamp=tampered_body,  # type: ignore[arg-type]
                nonce=nonce,
                platform_public_key_hex=pub_hex,
            )

    def test_expired_timestamp_raises(self):
        """A timestamp older than max_age_seconds is rejected."""
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        body = b'{"action":"fold"}'
        # 10 minutes ago — beyond the default 5 minute window
        old_timestamp = str(int(time.time()) - 600)
        nonce = "test-nonce-004"

        sig = sign_webhook(private_key, body, old_timestamp, nonce)

        with pytest.raises(ValueError, match="timestamp too old"):
            verify_webhook(
                body=body,
                signature_hex=sig,
                timestamp=old_timestamp,
                nonce=nonce,
                platform_public_key_hex=pub_hex,
            )

    def test_future_timestamp_outside_tolerance_raises(self):
        """A timestamp far in the future is rejected."""
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        body = b'{"state":"ok"}'
        # 10 minutes in the future
        future_timestamp = str(int(time.time()) + 600)
        nonce = "test-nonce-005"

        sig = sign_webhook(private_key, body, future_timestamp, nonce)

        with pytest.raises(ValueError, match="timestamp too old"):
            verify_webhook(
                body=body,
                signature_hex=sig,
                timestamp=future_timestamp,
                nonce=nonce,
                platform_public_key_hex=pub_hex,
            )

    def test_fresh_timestamp_boundary_is_accepted(self):
        """A timestamp at exactly max_age_seconds - 1 is accepted."""
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        body = b'{"phase":"flop"}'
        # Just inside the 5-minute window (299 seconds old)
        fresh_timestamp = str(int(time.time()) - 299)
        nonce = "test-nonce-006"

        sig = sign_webhook(private_key, body, fresh_timestamp, nonce)

        result = verify_webhook(
            body=body,
            signature_hex=sig,
            timestamp=fresh_timestamp,
            nonce=nonce,
            platform_public_key_hex=pub_hex,
            max_age_seconds=300,
        )
        assert result is True

    def test_message_format_is_timestamp_dot_nonce_dot_body(self):
        """
        Message format verification: signature covers '{timestamp}.{nonce}.{body}'.
        This must be consistent with the server's signWebhookPayload().
        """
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        body = b'{"game_id":"x"}'
        timestamp = str(int(time.time()))
        nonce = "unique-nonce-abc"

        # Sign using the EXACT format the platform server uses
        expected_message = f"{timestamp}.{nonce}.".encode() + body
        sig = private_key.sign(expected_message).hex()

        result = verify_webhook(
            body=body,
            signature_hex=sig,
            timestamp=timestamp,
            nonce=nonce,
            platform_public_key_hex=pub_hex,
        )
        assert result is True

    def test_all_zeros_signature_rejected(self):
        """All-zeros forged signature is rejected."""
        _, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        with pytest.raises(ValueError):
            verify_webhook(
                body=b'{"action":"fold"}',
                signature_hex="00" * 64,
                timestamp=str(int(time.time())),
                nonce="x",
                platform_public_key_hex=pub_hex,
            )


# ---------------------------------------------------------------------------
# 2. AgonAgent webhook server — full game flow
# ---------------------------------------------------------------------------


class SimplePokerAgent(AgonAgent):
    """Test implementation: always calls when possible, folds otherwise."""

    def decide(self, request: ActionRequest) -> ActionResponse:
        if Action.CALL in request.valid_actions:
            return ActionResponse(action=Action.CALL)
        return ActionResponse(action=Action.FOLD)


class RaisingAgent(AgonAgent):
    """Test implementation: always tries to raise."""

    def decide(self, request: ActionRequest) -> ActionResponse:
        if Action.RAISE in request.valid_actions:
            return ActionResponse(action=Action.RAISE, amount=request.state.min_raise)
        return ActionResponse(action=Action.FOLD)


class TestAgonAgentServer:
    """
    Tests for AgonAgent webhook server.

    Tests the complete flow: server receives action request → verifies signature
    → calls decide() → returns valid action response.
    """

    def test_health_check_endpoint(self):
        """GET /health returns ok."""
        agent = SimplePokerAgent(name="TestPokerAgent")
        client = TestClient(agent.app)

        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert resp.json()["agent"] == "TestPokerAgent"

    def test_action_without_signature_verification(self):
        """Without a platform key, agent processes requests without sig check."""
        agent = SimplePokerAgent(verify_signatures=False)
        client = TestClient(agent.app)

        request = make_action_request(valid_actions=["fold", "call"])
        resp = client.post("/action", json=request.model_dump())

        assert resp.status_code == 200
        assert resp.json()["action"] == "call"

    def test_action_with_valid_signature_passes(self):
        """Valid signature from platform → agent processes the request."""
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        agent = SimplePokerAgent(platform_public_key=pub_hex)
        client = TestClient(agent.app)

        request = make_action_request(valid_actions=["fold", "call", "raise"])
        body = json.dumps(request.model_dump()).encode()

        timestamp = str(int(time.time()))
        nonce = "nonce-hand-001"
        sig = sign_webhook(private_key, body, timestamp, nonce)

        resp = client.post(
            "/action",
            content=body,
            headers={
                "Content-Type": "application/json",
                "x-agon-signature": sig,
                "x-agon-timestamp": timestamp,
                "x-agon-nonce": nonce,
            },
        )

        assert resp.status_code == 200
        assert resp.json()["action"] == "call"

    def test_action_with_invalid_signature_returns_401(self):
        """Invalid/forged signature → 401 Unauthorized."""
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        agent = SimplePokerAgent(platform_public_key=pub_hex)
        client = TestClient(agent.app)

        request = make_action_request()
        body = json.dumps(request.model_dump()).encode()

        timestamp = str(int(time.time()))
        nonce = "nonce-hand-002"

        # Sign with a DIFFERENT key (forgery)
        wrong_key, _ = make_keypair()
        forged_sig = sign_webhook(wrong_key, body, timestamp, nonce)

        resp = client.post(
            "/action",
            content=body,
            headers={
                "Content-Type": "application/json",
                "x-agon-signature": forged_sig,
                "x-agon-timestamp": timestamp,
                "x-agon-nonce": nonce,
            },
        )

        assert resp.status_code == 401

    def test_action_missing_signature_headers_returns_401(self):
        """Missing signature headers → 401."""
        _, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        agent = SimplePokerAgent(platform_public_key=pub_hex)
        client = TestClient(agent.app)

        request = make_action_request()
        resp = client.post("/action", json=request.model_dump())

        assert resp.status_code == 401

    def test_raise_action_with_amount(self):
        """Agent can respond with raise + amount."""
        agent = RaisingAgent(verify_signatures=False)
        client = TestClient(agent.app)

        request = make_action_request(valid_actions=["fold", "call", "raise"])
        resp = client.post("/action", json=request.model_dump())

        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "raise"
        assert data["amount"] == request.state.min_raise

    def test_invalid_action_falls_back_to_fold(self):
        """If decide() returns an action not in valid_actions, server folds."""
        private_key, public_key = make_keypair()
        pub_hex = public_key_hex(public_key)

        # Agent always raises, but valid_actions only contains fold and call
        agent = RaisingAgent(platform_public_key=pub_hex)
        client = TestClient(agent.app)

        # Only fold/call are valid — raise is not
        request = make_action_request(valid_actions=["fold", "call"])
        body = json.dumps(request.model_dump()).encode()

        timestamp = str(int(time.time()))
        nonce = "nonce-fallback-001"
        sig = sign_webhook(private_key, body, timestamp, nonce)

        resp = client.post(
            "/action",
            content=body,
            headers={
                "Content-Type": "application/json",
                "x-agon-signature": sig,
                "x-agon-timestamp": timestamp,
                "x-agon-nonce": nonce,
            },
        )

        assert resp.status_code == 200
        # RaisingAgent returns raise, but it's not valid → falls back to fold
        assert resp.json()["action"] == "fold"

    def test_pre_flop_hand_complete_flow(self):
        """Full pre-flop hand: server sends request → agent responds → no errors."""
        agent = SimplePokerAgent(verify_signatures=False)
        client = TestClient(agent.app)

        # Pre-flop: big blind posted, agent needs to act
        request = make_action_request(
            phase="pre_flop",
            valid_actions=["fold", "call", "raise"],
        )
        resp = client.post("/action", json=request.model_dump())

        assert resp.status_code == 200
        action_data = resp.json()
        assert action_data["action"] in ["fold", "call", "raise"]

    def test_flop_hand_with_community_cards(self):
        """Flop: agent receives community cards and responds."""
        agent = SimplePokerAgent(verify_signatures=False)
        client = TestClient(agent.app)

        request = ActionRequest(
            game_id="game-002",
            hand_id="hand-002",
            state=GameState(
                phase="flop",
                pot=300,
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
                    PlayerState(agent_id="a1", agent_name="Bot", seat_index=0, stack=700),
                    PlayerState(agent_id="a2", agent_name="Opp", seat_index=1, stack=700),
                ],
                current_bet=0,
                min_raise=20,
                dealer_index=0,
                hand_number=5,
            ),
            valid_actions=[Action.CHECK, Action.RAISE],
            timeout_ms=5000,
        )

        resp = client.post("/action", json=request.model_dump())
        assert resp.status_code == 200
        # SimplePokerAgent: call not available → fold
        assert resp.json()["action"] in ["fold", "check", "raise"]


# ---------------------------------------------------------------------------
# 3. AgonClient — full registration and game join flow (mocked HTTP)
# ---------------------------------------------------------------------------


class TestAgonClientFlow:
    """
    Tests for AgonClient HTTP flow.

    Mocks httpx to verify the correct endpoints are called in sequence:
    register → create_agent → join_arena → start_arena
    """

    def _make_mock_response(self, json_data: dict, status_code: int = 200) -> MagicMock:
        mock = MagicMock()
        mock.json.return_value = json_data
        mock.status_code = status_code
        mock.raise_for_status = MagicMock()
        return mock

    def test_register_flow(self):
        """register() calls POST /auth/register and stores the token."""
        from agon_sdk.client import AgonClient

        with patch("agon_sdk.client.httpx.Client") as MockClient:
            mock_http = MagicMock()
            MockClient.return_value = mock_http
            mock_http.post.return_value = self._make_mock_response({
                "token": "jwt-access-token",
                "user": {"id": "user-001", "username": "myagent"},
            })

            client = AgonClient(base_url="https://api.agon.win")
            result = client.register(
                username="myagent",
                email="myagent@example.com",
                password="secure123",
            )

            mock_http.post.assert_called_once_with(
                "/auth/register",
                json={
                    "username": "myagent",
                    "email": "myagent@example.com",
                    "password": "secure123",
                },
                headers={"Content-Type": "application/json"},
            )
            assert result["token"] == "jwt-access-token"
            # Token is stored on the client
            assert client._token == "jwt-access-token"

    def test_create_agent_flow(self):
        """create_agent() calls POST /agents with agent registration payload."""
        from agon_sdk.client import AgonClient

        with patch("agon_sdk.client.httpx.Client") as MockClient:
            mock_http = MagicMock()
            MockClient.return_value = mock_http
            mock_http.post.return_value = self._make_mock_response({
                "agent": {"id": "agent-001", "name": "PythonBot"},
                "apiKey": "agon-api-key-xyz",
                "platformPublicKey": "a" * 64,
            })

            client = AgonClient(base_url="https://api.agon.win", token="jwt-token")
            result = client.create_agent(
                name="PythonBot",
                api_url="https://my-agent.example.com/action",
                webhook_public_key="b" * 64,
            )

            mock_http.post.assert_called_once()
            call_kwargs = mock_http.post.call_args
            assert call_kwargs[0][0] == "/agents"
            assert result["apiKey"] == "agon-api-key-xyz"
            assert result["platformPublicKey"] == "a" * 64

    def test_join_arena_flow(self):
        """join_arena() calls POST /arenas/{id}/join with agentId."""
        from agon_sdk.client import AgonClient

        with patch("agon_sdk.client.httpx.Client") as MockClient:
            mock_http = MagicMock()
            MockClient.return_value = mock_http
            mock_http.post.return_value = self._make_mock_response({"seat": 0})

            client = AgonClient(base_url="https://api.agon.win", token="jwt-token")
            result = client.join_arena(
                arena_id="arena-001",
                agent_id="agent-001",
            )

            mock_http.post.assert_called_once_with(
                "/arenas/arena-001/join",
                json={"agentId": "agent-001"},
                headers={"Content-Type": "application/json", "Authorization": "Bearer jwt-token"},
            )
            assert result["seat"] == 0

    def test_full_registration_to_join_flow(self):
        """
        Complete flow: register → create_agent → list_arenas → join_arena.
        Verifies API endpoint sequence and token propagation.
        """
        from agon_sdk.client import AgonClient

        with patch("agon_sdk.client.httpx.Client") as MockClient:
            mock_http = MagicMock()
            MockClient.return_value = mock_http

            # Step 1: Register
            mock_http.post.side_effect = [
                self._make_mock_response({
                    "token": "my-jwt-token",
                    "user": {"id": "user-001", "username": "pybot"},
                }),
                # Step 2: Create agent
                self._make_mock_response({
                    "agent": {"id": "agent-001"},
                    "apiKey": "api-key-001",
                    "platformPublicKey": "c" * 64,
                }),
                # Step 4: Join arena
                self._make_mock_response({"seat": 2}),
            ]
            mock_http.get.return_value = self._make_mock_response({
                "arenas": [{"id": "arena-001", "name": "Practice Table 1", "status": "waiting"}],
            })

            client = AgonClient(base_url="https://api.agon.win")

            # Step 1: Register (sets token)
            reg_result = client.register("pybot", "pybot@example.com", "pass123")
            assert reg_result["token"] == "my-jwt-token"

            # Step 2: Create agent
            agent_result = client.create_agent(
                name="PyPokerBot",
                api_url="https://pybot.example.com/action",
                webhook_public_key="d" * 64,
            )
            platform_pub_key = agent_result["platformPublicKey"]
            assert len(platform_pub_key) == 64

            # Step 3: Find available arenas
            arenas = client.list_arenas(status="waiting")
            assert len(arenas) == 1
            arena_id = arenas[0]["id"]

            # Step 4: Join arena
            join_result = client.join_arena(arena_id, "agent-001")
            assert join_result["seat"] == 2

    def test_get_platform_public_key(self):
        """get_platform_public_key() returns the hex Ed25519 key."""
        from agon_sdk.client import AgonClient

        with patch("agon_sdk.client.httpx.Client") as MockClient:
            mock_http = MagicMock()
            MockClient.return_value = mock_http
            mock_http.get.return_value = self._make_mock_response({
                "publicKey": "e" * 64,
            })

            client = AgonClient(base_url="https://api.agon.win")
            key = client.get_platform_public_key()

            assert key == "e" * 64
            mock_http.get.assert_called_once_with("/auth/public-key")


# ---------------------------------------------------------------------------
# 4. Model validation tests
# ---------------------------------------------------------------------------


class TestModels:
    """Game state model validation tests."""

    def test_action_request_parses_full_game_state(self):
        """ActionRequest model handles all game fields correctly."""
        req = make_action_request(phase="river")
        assert req.state.phase == "river"
        assert req.state.pot == 150
        assert len(req.state.hole_cards) == 2
        assert req.state.hole_cards[0].rank == Rank.ACE

    def test_action_response_fold(self):
        resp = ActionResponse(action=Action.FOLD)
        assert resp.action == Action.FOLD
        assert resp.amount is None

    def test_action_response_raise_requires_amount(self):
        resp = ActionResponse(action=Action.RAISE, amount=200)
        assert resp.action == Action.RAISE
        assert resp.amount == 200

    def test_all_in_response(self):
        resp = ActionResponse(action=Action.ALL_IN)
        assert resp.action == Action.ALL_IN

    def test_card_string_representation(self):
        card = Card(rank=Rank.ACE, suit=Suit.SPADES)
        assert str(card) == "As"
        assert str(Card(rank=Rank.TEN, suit=Suit.HEARTS)) == "Th"
        assert str(Card(rank=Rank.KING, suit=Suit.CLUBS)) == "Kc"

    def test_game_state_with_all_phases(self):
        """All poker phases should be valid GameState values."""
        for phase in ["pre_flop", "flop", "turn", "river", "showdown"]:
            req = make_action_request(phase=phase)
            assert req.state.phase == phase
