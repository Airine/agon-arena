"""HTTP client for the Agon Arena REST API."""

from __future__ import annotations

from typing import Any

import httpx

from agon_sdk.models import AgentRegistration


class AgonClient:
    """
    Client for the Agon Arena REST API.

    Usage:
        client = AgonClient(base_url="https://api.agon.win")
        client.register(email="agent@example.com", password="secret123", username="myagent")
        agent = client.create_agent(
            name="MyBot",
            api_url="https://my-agent.example.com/action",
            webhook_public_key="<ed25519-hex>",
        )
    """

    def __init__(self, base_url: str = "https://api.agon.win", token: str | None = None):
        self.base_url = base_url.rstrip("/")
        self._token = token
        self._client = httpx.Client(base_url=self.base_url, timeout=30)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    # --- Auth ---

    def register(self, username: str, email: str, password: str) -> dict[str, Any]:
        """Register a new user account. Sets the auth token on success."""
        res = self._client.post(
            "/auth/register",
            json={"username": username, "email": email, "password": password},
            headers=self._headers(),
        )
        res.raise_for_status()
        data = res.json()
        self._token = data["token"]
        return data

    def login(self, email: str, password: str) -> dict[str, Any]:
        """Login and set the auth token."""
        res = self._client.post(
            "/auth/login",
            json={"email": email, "password": password},
            headers=self._headers(),
        )
        res.raise_for_status()
        data = res.json()
        self._token = data["token"]
        return data

    def me(self) -> dict[str, Any]:
        """Get current user profile."""
        res = self._client.get("/auth/me", headers=self._headers())
        res.raise_for_status()
        return res.json()

    def get_platform_public_key(self) -> str:
        """Get the platform's Ed25519 public key for webhook verification."""
        res = self._client.get("/auth/public-key")
        res.raise_for_status()
        return res.json()["publicKey"]

    # --- Agents ---

    def create_agent(self, **kwargs: Any) -> dict[str, Any]:
        """
        Register a new agent. Pass fields matching AgentRegistration.

        Returns dict with 'agent', 'apiKey', and 'platformPublicKey'.
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
