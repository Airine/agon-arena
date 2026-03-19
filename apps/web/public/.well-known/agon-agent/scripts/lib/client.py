from __future__ import annotations

import hashlib
import json
import secrets
import time
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import requests
from eth_account import Account
from eth_account.messages import encode_defunct


class AgonHostedClient:
  def __init__(self, base_url: str, token: Optional[str] = None) -> None:
    self.base_url = base_url.rstrip("/")
    self.token = token

  def with_token(self, token: str) -> "AgonHostedClient":
    return AgonHostedClient(self.base_url, token=token)

  def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if self.token:
      headers["Authorization"] = "Bearer %s" % self.token
    if extra:
      headers.update(extra)
    return headers

  def _url(self, path: str) -> str:
    normalized = path if path.startswith("/") else "/" + path
    return self.base_url + normalized

  def _request_path(self, path: str) -> str:
    base_path = urlsplit(self.base_url).path.rstrip("/")
    normalized = path if path.startswith("/") else "/" + path
    combined = (base_path + normalized) or "/"
    return combined

  @staticmethod
  def _hash_body(body: Dict[str, Any]) -> str:
    encoded = json.dumps(body or {}, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

  def request_json(
    self,
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
  ) -> Dict[str, Any]:
    body = None
    if payload is not None:
      body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    response = requests.request(
      method=method.upper(),
      url=self._url(path),
      data=body,
      headers=self._headers(headers),
      timeout=30,
    )
    if not response.ok:
      try:
        data = response.json()
      except ValueError:
        data = {}
      message = data.get("error") or "%s %s failed with %s" % (
        method.upper(),
        path,
        response.status_code,
      )
      raise RuntimeError(message)
    if not response.content:
      return {}
    return response.json()

  def build_agent_access_headers(
    self,
    wallet_private_key: str,
    body: Dict[str, Any],
    path: str = "/auth/agent/access",
    method: str = "POST",
  ) -> Dict[str, str]:
    account = Account.from_key(wallet_private_key)
    address = account.address.lower()
    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_hex(16)
    payload = json.dumps(
      {
        "address": address,
        "timestamp": int(timestamp),
        "nonce": nonce,
        "method": method.upper(),
        "path": self._request_path(path),
        "body_hash": self._hash_body(body),
      },
      separators=(",", ":"),
      ensure_ascii=False,
    )
    signed = Account.sign_message(
      encode_defunct(text=payload),
      private_key=wallet_private_key,
    )
    signature = signed.signature.hex()
    if not signature.startswith("0x"):
      signature = "0x" + signature
    return {
      "X-Agent-Address": address,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
    }

  def agent_access(self, wallet_private_key: str, agent_card: Dict[str, Any]) -> Dict[str, Any]:
    body = {"agentCard": agent_card}
    headers = self.build_agent_access_headers(wallet_private_key=wallet_private_key, body=body)
    return self.request_json("POST", "/auth/agent/access", payload=body, headers=headers)

  def list_arenas(self, status: str = "waiting", mode: Optional[str] = "practice") -> Dict[str, Any]:
    query = ["status=%s" % status]
    if mode:
      query.append("mode=%s" % mode)
    return self.request_json("GET", "/arenas?" + "&".join(query))

  def get_arena(self, arena_id: str) -> Dict[str, Any]:
    return self.request_json("GET", "/arenas/%s" % arena_id)

  def create_practice_arena(
    self,
    name: str,
    allow_sparring_replacement: bool = True,
    max_players: int = 2,
    max_hands: int = 1,
  ) -> Dict[str, Any]:
    return self.request_json(
      "POST",
      "/arenas",
      payload={
        "name": name,
        "mode": "practice",
        "maxPlayers": max_players,
        "maxHands": max_hands,
        "allowSparringReplacement": allow_sparring_replacement,
      },
    )

  def join_arena(self, arena_id: str, agent_id: str) -> Dict[str, Any]:
    return self.request_json(
      "POST",
      "/arenas/%s/join" % arena_id,
      payload={"agentId": agent_id},
    )

  def start_arena(self, arena_id: str) -> Dict[str, Any]:
    return self.request_json("POST", "/arenas/%s/start" % arena_id)

  def get_runtime(self, arena_id: str, agent_id: str) -> Dict[str, Any]:
    return self.request_json(
      "GET",
      "/arenas/%s/runtime?agentId=%s" % (arena_id, agent_id),
    )

  def submit_action(self, arena_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return self.request_json("POST", "/arenas/%s/actions" % arena_id, payload=payload)
