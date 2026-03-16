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
    parser.add_argument("--status", default="waiting")
    parser.add_argument("--mode", default="practice")
    args = parser.parse_args()

    session = load_session(args.state_dir, args.role)
    token = session.get("access_token") if session else None
    client = AgonHostedClient(args.api_base, token=token)
    result = client.list_arenas(status=args.status, mode=args.mode)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
