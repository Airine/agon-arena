"""FastAPI-based webhook server template for Agon agents."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from fastapi import FastAPI, Request, HTTPException

from agon_sdk.models import ActionRequest, ActionResponse, Action
from agon_sdk.verify import verify_webhook

logger = logging.getLogger("agon_sdk")


class AgonAgent(ABC):
    """
    Base class for building an Agon Arena poker agent.

    Subclass this and implement `decide()` to define your agent's strategy.

    Usage:
        class MyAgent(AgonAgent):
            def decide(self, request: ActionRequest) -> ActionResponse:
                # Your poker strategy here
                return ActionResponse(action=Action.CALL)

        agent = MyAgent(platform_public_key="<hex>")
        agent.run(port=8080)
    """

    def __init__(
        self,
        platform_public_key: str | None = None,
        verify_signatures: bool = True,
        name: str = "AgonAgent",
    ):
        self.platform_public_key = platform_public_key
        self.verify_signatures = verify_signatures and platform_public_key is not None
        self.name = name
        self.app = self._create_app()

    @abstractmethod
    def decide(self, request: ActionRequest) -> ActionResponse:
        """
        Implement your poker strategy here.

        Args:
            request: The action request from the platform, containing game state,
                     your hole cards, community cards, and valid actions.

        Returns:
            Your chosen action (fold, check, call, raise, all_in).
        """
        ...

    def on_error(self, request: ActionRequest, error: Exception) -> ActionResponse:
        """
        Called when `decide()` raises an exception. Default: fold.
        Override to implement custom error handling.
        """
        logger.error("Error in decide(): %s — folding", error)
        return ActionResponse(action=Action.FOLD)

    def _create_app(self) -> FastAPI:
        app = FastAPI(title=self.name, version="0.1.0")

        @app.get("/health")
        async def health() -> dict[str, Any]:
            return {"status": "ok", "agent": self.name}

        @app.post("/action")
        async def action(raw_request: Request) -> dict[str, Any]:
            body = await raw_request.body()

            # Verify webhook signature
            if self.verify_signatures:
                sig = raw_request.headers.get("x-agon-signature", "")
                ts = raw_request.headers.get("x-agon-timestamp", "")
                nonce = raw_request.headers.get("x-agon-nonce", "")

                if not sig or not ts or not nonce:
                    raise HTTPException(status_code=401, detail="Missing signature headers")

                try:
                    verify_webhook(
                        body=body,
                        signature_hex=sig,
                        timestamp=ts,
                        nonce=nonce,
                        platform_public_key_hex=self.platform_public_key,  # type: ignore[arg-type]
                    )
                except ValueError as e:
                    raise HTTPException(status_code=401, detail=str(e))

            # Parse and process
            action_request = ActionRequest.model_validate_json(body)

            try:
                response = self.decide(action_request)
            except Exception as e:
                response = self.on_error(action_request, e)

            # Validate the response action is valid
            if response.action not in action_request.valid_actions:
                logger.warning(
                    "Action %s not in valid_actions %s — falling back to fold",
                    response.action,
                    action_request.valid_actions,
                )
                response = ActionResponse(action=Action.FOLD)

            return response.model_dump(exclude_none=True)

        return app

    def run(self, host: str = "0.0.0.0", port: int = 8080) -> None:
        """Start the agent webhook server."""
        import uvicorn

        logger.info("Starting %s on %s:%d", self.name, host, port)
        uvicorn.run(self.app, host=host, port=port)
