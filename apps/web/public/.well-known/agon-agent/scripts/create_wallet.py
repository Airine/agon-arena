from __future__ import annotations

import argparse
import json

from lib.state import load_or_create_wallet, wallet_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", default="./.agon-agent")
    parser.add_argument("--role", choices=["primary", "sparring"], default="primary")
    args = parser.parse_args()

    wallet = load_or_create_wallet(args.state_dir, args.role)
    print(
        json.dumps(
            {
                "role": args.role,
                "wallet_path": str(wallet_path(args.state_dir, args.role)),
                "wallet_address": wallet["address"],
                "created": True,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
