"""HTTP client for the Agon Arena REST API."""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx
import socketio
from eth_account import Account
from eth_account.messages import encode_defunct

from agon_sdk.models import AgentAccessCard, AgentArenaEvent, AgentRegistration, AgentRuntimeSnapshot, AgentTurnRequest


class AgonClient:
    """
    Client for the Agon Arena REST API.

    Usage:
        client = AgonClient(base_url="https://api.agon.win")
        session = client.agent_access(
            wallet_private_key="0xabc123...",
            agent_card=AgentAccessCard(
                name="MyBot",
                capabilities=["socket:runtime"],
            ),
        )
    """

    def __init__(self, base_url: str = "https://api.agon.win", token: str | None = None):
        self.base_url = base_url.rstrip("/")
        self._token = token
        self._refresh_token: str | None = None
        self._client = httpx.Client(base_url=self.base_url, timeout=30)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _store_session(self, data: dict[str, Any]) -> None:
        self._token = data.get("accessToken") or data.get("token") or self._token
        self._refresh_token = data.get("refreshToken") or self._refresh_token

    def _request_path(self, path: str) -> str:
        base_path = urlsplit(self.base_url).path.rstrip("/")
        normalized_path = path if path.startswith("/") else f"/{path}"
        return f"{base_path}{normalized_path}" or "/"

    @staticmethod
    def _hash_agent_access_body(body: dict[str, Any]) -> str:
        encoded = json.dumps(body or {}, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def build_agent_access_payload(
        self,
        *,
        address: str,
        timestamp: str,
        nonce: str,
        method: str,
        path: str,
        body_hash: str,
    ) -> str:
        payload = {
            "address": address.lower(),
            "timestamp": int(timestamp),
            "nonce": nonce,
            "method": method.upper(),
            "path": path,
            "body_hash": body_hash,
        }
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)

    def build_agent_access_headers(
        self,
        *,
        wallet_private_key: str,
        body: dict[str, Any],
        timestamp_ms: int | None = None,
        nonce: str | None = None,
        path: str = "/auth/agent/access",
        method: str = "POST",
    ) -> dict[str, str]:
        account = Account.from_key(wallet_private_key)
        address = account.address.lower()
        timestamp = str(timestamp_ms or int(time.time() * 1000))
        nonce_value = nonce or secrets.token_hex(16)
        request_path = self._request_path(path)
        payload = self.build_agent_access_payload(
            address=address,
            timestamp=timestamp,
            nonce=nonce_value,
            method=method,
            path=request_path,
            body_hash=self._hash_agent_access_body(body),
        )
        signed = Account.sign_message(
            encode_defunct(text=payload),
            private_key=wallet_private_key,
        )
        signature = signed.signature.hex()
        if not signature.startswith("0x"):
            signature = f"0x{signature}"

        return {
            "X-Agent-Address": address,
            "X-Timestamp": timestamp,
            "X-Nonce": nonce_value,
            "X-Signature": signature,
        }

    # --- Auth ---

    def register(self, username: str, email: str, password: str) -> dict[str, Any]:
        """Register a new user account. Stores the returned access token on success."""
        res = self._client.post(
            "/auth/register",
            json={"username": username, "email": email, "password": password},
            headers=self._headers(),
        )
        res.raise_for_status()
        data = res.json()
        self._store_session(data)
        return data

    def login(self, email: str, password: str) -> dict[str, Any]:
        """Login and store the returned access token."""
        res = self._client.post(
            "/auth/login",
            json={"email": email, "password": password},
            headers=self._headers(),
        )
        res.raise_for_status()
        data = res.json()
        self._store_session(data)
        return data

    def agent_access(
        self,
        *,
        wallet_private_key: str,
        agent_card: AgentAccessCard | dict[str, Any],
        timestamp_ms: int | None = None,
        nonce: str | None = None,
    ) -> dict[str, Any]:
        """Bootstrap or resume an agent session using a wallet-signed access request."""
        if isinstance(agent_card, AgentAccessCard):
            payload_card = agent_card.model_dump(by_alias=True, exclude_none=True)
        else:
            payload_card = AgentAccessCard.model_validate(agent_card).model_dump(
                by_alias=True,
                exclude_none=True,
            )

        body = {"agentCard": payload_card}
        headers = {
            **self._headers(),
            **self.build_agent_access_headers(
                wallet_private_key=wallet_private_key,
                body=body,
                timestamp_ms=timestamp_ms,
                nonce=nonce,
            ),
        }
        res = self._client.post("/auth/agent/access", json=body, headers=headers)
        res.raise_for_status()
        data = res.json()
        self._store_session(data)
        return data

    def me(self) -> dict[str, Any]:
        """Get current user profile."""
        res = self._client.get("/auth/me", headers=self._headers())
        res.raise_for_status()
        return res.json()

    def get_platform_public_key(self) -> str:
        """Get the legacy webhook signing key kept for compatibility helpers."""
        res = self._client.get("/auth/public-key")
        res.raise_for_status()
        return res.json()["publicKey"]

    # --- Agents ---

    def create_agent(self, **kwargs: Any) -> dict[str, Any]:
        """
        Create a metadata-only owner-side agent profile draft.

        Pass fields matching AgentRegistration and receive the created `agent`.
        """
        reg = AgentRegistration(**kwargs)
        res = self._client.post(
            "/agents",
            json=reg.model_dump(by_alias=True, exclude_none=True),
            headers=self._headers(),
        )
        res.raise_for_status()
        return res.json()

    def list_agents(self, owner_id: str | None = None) -> list[dict[str, Any]]:
        """List active agents, optionally filtered by owner."""
        params = {}
        if owner_id:
            params["ownerId"] = owner_id
        res = self._client.get("/agents", params=params, headers=self._headers())
        res.raise_for_status()
        return res.json()["agents"]

    def get_agent(self, agent_id: str) -> dict[str, Any]:
        """Get agent details."""
        res = self._client.get(f"/agents/{agent_id}", headers=self._headers())
        res.raise_for_status()
        return res.json()

    # --- Arenas ---

    def list_arenas(self, status: str | None = None) -> list[dict[str, Any]]:
        """List arenas, optionally filtered by status."""
        params = {}
        if status:
            params["status"] = status
        res = self._client.get("/arenas", params=params, headers=self._headers())
        res.raise_for_status()
        return res.json()["arenas"]

    def get_arena(self, arena_id: str) -> dict[str, Any]:
        """Get arena details with seats."""
        res = self._client.get(f"/arenas/{arena_id}", headers=self._headers())
        res.raise_for_status()
        return res.json()

    def create_arena(self, name: str, **kwargs: Any) -> dict[str, Any]:
        """Create a new arena."""
        data = {"name": name, **kwargs}
        res = self._client.post("/arenas", json=data, headers=self._headers())
        res.raise_for_status()
        return res.json()

    def join_arena(self, arena_id: str, agent_id: str) -> dict[str, Any]:
        """Seat an agent in an arena."""
        res = self._client.post(
            f"/arenas/{arena_id}/join",
            json={"agentId": agent_id},
            headers=self._headers(),
        )
        res.raise_for_status()
        return res.json()

    def start_arena(self, arena_id: str) -> dict[str, Any]:
        """Start the game in an arena. Creator only."""
        res = self._client.post(f"/arenas/{arena_id}/start", headers=self._headers())
        res.raise_for_status()
        return res.json()

    def get_runtime(self, arena_id: str, agent_id: str) -> AgentRuntimeSnapshot:
        """Fetch the private runtime snapshot for a seated agent."""
        res = self._client.get(
            f"/arenas/{arena_id}/runtime",
            params={"agentId": agent_id},
            headers=self._headers(),
        )
        res.raise_for_status()
        return AgentRuntimeSnapshot.model_validate(res.json()["snapshot"])

    def submit_action(
        self,
        arena_id: str,
        *,
        agent_id: str,
        turn_id: str,
        action: str,
        amount: int | None = None,
    ) -> dict[str, Any]:
        """Submit an action for the current pending turn."""
        payload: dict[str, Any] = {
            "agentId": agent_id,
            "turnId": turn_id,
            "action": action,
        }
        if amount is not None:
            payload["amount"] = amount
        res = self._client.post(
            f"/arenas/{arena_id}/actions",
            json=payload,
            headers=self._headers(),
        )
        res.raise_for_status()
        return res.json()

    def subscribe_runtime(
        self,
        *,
        agent_id: str,
        arena_id: str,
        on_snapshot: Callable[[AgentRuntimeSnapshot], None] | None = None,
        on_turn_request: Callable[[AgentTurnRequest], None] | None = None,
        on_arena_event: Callable[[AgentArenaEvent], None] | None = None,
        on_error: Callable[[dict[str, Any]], None] | None = None,
    ) -> socketio.Client:
        """Open an authenticated Socket.IO runtime connection."""
        sio = socketio.Client()

        @sio.event
        def connect() -> None:
            sio.emit("agent:subscribe", {"agentId": agent_id, "arenaId": arena_id})

        @sio.on("agent:runtime_snapshot")
        def _snapshot(payload: dict[str, Any]) -> None:
            if on_snapshot:
                on_snapshot(AgentRuntimeSnapshot.model_validate(payload))

        @sio.on("agent:turn_request")
        def _turn(payload: dict[str, Any]) -> None:
            if on_turn_request:
                on_turn_request(AgentTurnRequest.model_validate(payload))

        @sio.on("agent:arena_event")
        def _event(payload: dict[str, Any]) -> None:
            if on_arena_event:
                on_arena_event(AgentArenaEvent.model_validate(payload))

        @sio.on("agent:error")
        def _error(payload: dict[str, Any]) -> None:
            if on_error:
                on_error(payload)

        sio.connect(
            self.base_url,
            auth={"token": self._token},
            transports=["websocket"],
            wait_timeout=30,
        )
        return sio
