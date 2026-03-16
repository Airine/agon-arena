from __future__ import annotations

import argparse
import json
from typing import Any, Dict

from bootstrap_identity import bootstrap_identity


def build_metadata(role: str, framework: str | None) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {
        "runtimeRole": role,
    }
    if framework:
        metadata["framework"] = framework
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://agon.win:4000")
    parser.add_argument("--state-dir", default="./.agon-agent")
    parser.add_argument("--role", choices=["primary", "sparring"], default="primary")
    parser.add_argument("--name", default=None)
    args = parser.parse_args()

    result = bootstrap_identity(
        api_base=args.api_base,
        state_dir=args.state_dir,
        role=args.role,
        name=args.name,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
