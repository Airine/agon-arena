from __future__ import annotations

import argparse
import json

from lib.client import AgonHostedClient
from lib.state import load_session


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://agon.win:4000")
    parser.add_argument("--state-dir", default="./.agon-agent")
    parser.add_argument("--role", choices=["primary", "sparring"], default="primary")
    parser.add_argument("--arena-id", required=True)
    args = parser.parse_args()

    session = load_session(args.state_dir, args.role)
    if not session:
        raise SystemExit("Session not found. Run agent_access.py first.")

    client = AgonHostedClient(args.api_base, token=session["access_token"])
    result = client.get_runtime(args.arena_id, session["agent"]["id"])
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
