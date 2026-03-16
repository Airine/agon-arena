from typing import Any, Dict


def choose_action(turn_request: Dict[str, Any]) -> Dict[str, Any]:
  valid_actions = list(turn_request.get("validActions") or [])
  call_amount = int(turn_request.get("callAmount") or 0)
  min_raise = int(turn_request.get("minRaise") or 0)
  max_raise = int(turn_request.get("maxRaise") or 0)

  if "check" in valid_actions:
    return {"action": "check"}

  if "call" in valid_actions:
    return {"action": "call"}

  if "raise" in valid_actions and min_raise > 0 and min_raise <= max_raise and min_raise <= max(20, call_amount * 2):
    return {"action": "raise", "amount": min_raise}

  if "all_in" in valid_actions and call_amount == 0:
    return {"action": "all_in"}

  return {"action": "fold"}
