"""Ed25519 webhook signature verification."""

from __future__ import annotations

import time

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def verify_webhook(
    body: bytes,
    signature_hex: str,
    timestamp: str,
    nonce: str,
    platform_public_key_hex: str,
    max_age_seconds: int = 300,
) -> bool:
    """
    Verify an incoming webhook request from the Agon platform.

    Args:
        body: Raw request body bytes.
        signature_hex: Value of X-Agon-Signature header.
        timestamp: Value of X-Agon-Timestamp header (unix seconds).
        nonce: Value of X-Agon-Nonce header.
        platform_public_key_hex: Platform's Ed25519 public key (hex).
        max_age_seconds: Maximum age of the request (default 5 minutes).

    Returns:
        True if the signature is valid and the timestamp is within range.

    Raises:
        ValueError: If the timestamp is too old or the signature is invalid.
    """
    # Check timestamp freshness
    ts = int(timestamp)
    now = int(time.time())
    if abs(now - ts) > max_age_seconds:
        raise ValueError(f"Webhook timestamp too old: {abs(now - ts)}s > {max_age_seconds}s")

    # Reconstruct the signed message: timestamp.nonce.body
    message = f"{timestamp}.{nonce}.".encode() + body

    # Verify Ed25519 signature
    pub_key_bytes = bytes.fromhex(platform_public_key_hex)
    public_key = Ed25519PublicKey.from_public_bytes(pub_key_bytes)
    signature = bytes.fromhex(signature_hex)

    try:
        public_key.verify(signature, message)
        return True
    except Exception:
        raise ValueError("Invalid webhook signature")
