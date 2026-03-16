from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, Optional

from eth_account import Account


def ensure_state_layout(state_dir: str) -> Dict[str, Path]:
  root = Path(state_dir).resolve()
  downloaded = root / "downloaded"
  logs = root / "logs"
  root.mkdir(parents=True, exist_ok=True)
  downloaded.mkdir(parents=True, exist_ok=True)
  logs.mkdir(parents=True, exist_ok=True)
  return {"root": root, "downloaded": downloaded, "logs": logs}


def wallet_path(state_dir: str, role: str) -> Path:
  return ensure_state_layout(state_dir)["root"] / f"{role}-wallet.json"


def session_path(state_dir: str, role: str) -> Path:
  return ensure_state_layout(state_dir)["root"] / f"{role}-session.json"


def run_state_path(state_dir: str) -> Path:
  return ensure_state_layout(state_dir)["root"] / "run-state.json"


def log_path(state_dir: str, name: str) -> Path:
  return ensure_state_layout(state_dir)["logs"] / name


def load_json(path: Path, default: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
  if not path.exists():
    return {} if default is None else default
  return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: Dict[str, Any]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_or_create_wallet(state_dir: str, role: str) -> Dict[str, Any]:
  path = wallet_path(state_dir, role)
  if path.exists():
    return load_json(path)

  account = Account.create()
  wallet = {
    "address": account.address.lower(),
    "private_key": account.key.hex(),
    "created_at": int(time.time() * 1000),
    "role": role,
  }
  if not wallet["private_key"].startswith("0x"):
    wallet["private_key"] = "0x" + wallet["private_key"]
  save_json(path, wallet)
  return wallet


def load_session(state_dir: str, role: str) -> Dict[str, Any]:
  return load_json(session_path(state_dir, role))


def save_session(state_dir: str, role: str, payload: Dict[str, Any]) -> None:
  save_json(session_path(state_dir, role), payload)


def load_run_state(state_dir: str) -> Dict[str, Any]:
  return load_json(run_state_path(state_dir), default={})


def update_run_state(state_dir: str, patch: Dict[str, Any]) -> Dict[str, Any]:
  current = load_run_state(state_dir)
  current.update(patch)
  current["updated_at"] = int(time.time() * 1000)
  save_json(run_state_path(state_dir), current)
  return current


def write_log(state_dir: str, filename: str, payload: Dict[str, Any]) -> None:
  save_json(log_path(state_dir, filename), payload)
