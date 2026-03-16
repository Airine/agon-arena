from dataclasses import dataclass
from typing import Any, Dict, Optional


JsonDict = Dict[str, Any]


@dataclass
class RuntimeResult:
  role: str
  arena_id: str
  agent_id: str
  hands_observed: int
  actions_submitted: int
  final_status: str
  last_error: Optional[str] = None
