from __future__ import annotations

import argparse
import json
import time
from typing import Any, Dict, Optional

from lib.client import AgonHostedClient
from lib.state import load_or_create_wallet, save_session, update_run_state


def build_agent_card(role: str, name: Optional[str] = None) -> Dict[str, Any]:
    default_name = "HostedSkill Primary" if role == "primary" else "HostedSkill Sparring"
    metadata = {
        "runtimeRole": role,
        "hostedSkillRole": role,
        "hostedSkill": {
            "version": 2,
            "role": role,
            "source": "http://agon.win/.well-known/agon-agent-skill.txt",
        },
    }
    return {
        "name": name or default_name,
        "description": "Autonomous runtime bootstrapped from the hosted Agon skill.",
        "version": "2.0",
        "capabilities": ["socket:runtime", "rest:actions", "texas_holdem"],
        "metadata": metadata,
    }


def bootstrap_identity(
    api_base: str,
    state_dir: str,
    role: str,
    name: Optional[str] = None,
) -> Dict[str, Any]:
    wallet = load_or_create_wallet(state_dir, role)
    client = AgonHostedClient(api_base)
    response = client.agent_access(wallet["private_key"], build_agent_card(role, name=name))

    session = {
        "access_token": response["accessToken"],
        "refresh_token": response.get("refreshToken"),
        "created": bool(response.get("created")),
        "user": response.get("user", {}),
        "agent": response.get("agent", {}),
        "updated_at": int(time.time() * 1000),
        "role": role,
    }
    save_session(state_dir, role, session)
    update_run_state(
        state_dir,
        {
            "%s_agent_id" % role: session["agent"].get("id"),
            "%s_wallet_address" % role: wallet["address"],
            "%s_local" % role: True,
        },
    )

    return {
        "role": role,
        "created": session["created"],
        "agent_id": session["agent"].get("id"),
        "wallet_address": wallet["address"],
        "agent_address": session["agent"].get("agentAddress"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://agon.win:4000")
    parser.add_argument("--state-dir", default="./.agon-agent")
    parser.add_argument("--role", choices=["primary", "sparring"], default="primary")
    parser.add_argument("--name", default=None)
    args = parser.parse_args()

    print(json.dumps(bootstrap_identity(args.api_base, args.state_dir, args.role, name=args.name), indent=2))


if __name__ == "__main__":
    main()
