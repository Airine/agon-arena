from __future__ import annotations

import argparse
import json
from typing import Any, Dict

from lib.state import load_json, load_run_state, log_path


def build_report(state_dir: str) -> Dict[str, Any]:
    run_state = load_run_state(state_dir)
    primary_log = load_json(log_path(state_dir, "primary-runtime.json"), default={})
    sparring_log = load_json(log_path(state_dir, "sparring-runtime.json"), default={})
    hands_observed = max(
        int(run_state.get("primary_hands_observed") or 0),
        int(run_state.get("sparring_hands_observed") or 0),
        int(primary_log.get("hands_observed") or 0),
        int(sparring_log.get("hands_observed") or 0),
    )
    hands_completed = max(
        int(run_state.get("primary_hands_completed") or 0),
        int(run_state.get("sparring_hands_completed") or 0),
        int(primary_log.get("hands_completed") or 0),
        int(sparring_log.get("hands_completed") or 0),
    )
    sparring_local = bool(run_state.get("sparring_local"))
    completed = (
        int(primary_log.get("actions_submitted") or 0) >= 1
        and (
            not sparring_local
            or int(sparring_log.get("actions_submitted") or 0) >= 1
        )
        and hands_completed >= 1
    )

    if completed:
        final_status = "completed"
    elif primary_log.get("final_status") == "timed_out" or sparring_log.get("final_status") == "timed_out":
        final_status = "timed_out"
    elif primary_log.get("final_status") == "failed" or sparring_log.get("final_status") == "failed":
        final_status = "failed"
    else:
        final_status = "partial"

    return {
        "primary_agent_id": run_state.get("primary_agent_id"),
        "primary_wallet_address": run_state.get("primary_wallet_address"),
        "sparring_agent_id": run_state.get("sparring_agent_id"),
        "sparring_wallet_address": run_state.get("sparring_wallet_address"),
        "arena_id": run_state.get("arena_id"),
        "hands_observed": hands_observed,
        "final_status": final_status,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", default="./.agon-agent")
    args = parser.parse_args()
    print(json.dumps(build_report(args.state_dir), indent=2))


if __name__ == "__main__":
    main()
