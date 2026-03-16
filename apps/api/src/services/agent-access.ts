import { createHash } from 'crypto';
import { verifyMessage } from 'viem';
import { z } from 'zod';

const MAX_TIMESTAMP_SKEW_MS = 60_000;

export const agentCardSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  version: z.string().default('1.0'),
  capabilities: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export const agentAccessHeaderSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  timestamp: z.string().regex(/^\d{10,16}$/, 'Invalid timestamp'),
  nonce: z.string().min(8).max(128),
  signature: z.string().startsWith('0x'),
});

export function hashAgentAccessBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

export interface AgentAccessPayloadInput {
  address: string;
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  bodyHash: string;
}

export function buildAgentAccessPayload(input: AgentAccessPayloadInput): string {
  return JSON.stringify({
    address: input.address.toLowerCase(),
    timestamp: Number(input.timestamp),
    nonce: input.nonce,
    method: input.method.toUpperCase(),
    path: input.path,
    body_hash: input.bodyHash,
  });
}

export interface VerifyAgentAccessRequestInput {
  headers: z.infer<typeof agentAccessHeaderSchema>;
  method: string;
  path: string;
  body: unknown;
  nowMs?: number;
}

export async function verifyAgentAccessRequest(
  input: VerifyAgentAccessRequestInput,
): Promise<{ ok: true; walletAddress: string } | { ok: false; status: number; error: string }> {
  const walletAddress = input.headers.address.toLowerCase();
  const timestampMs = Number(input.headers.timestamp);

  if (!Number.isFinite(timestampMs)) {
    return { ok: false, status: 400, error: 'Invalid timestamp' };
  }

  const nowMs = input.nowMs ?? Date.now();
  if (Math.abs(nowMs - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, status: 401, error: 'Timestamp is outside the allowed window' };
  }

  const payload = buildAgentAccessPayload({
    address: walletAddress,
    timestamp: input.headers.timestamp,
    nonce: input.headers.nonce,
    method: input.method,
    path: input.path,
    bodyHash: hashAgentAccessBody(input.body),
  });

  try {
    const valid = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message: payload,
      signature: input.headers.signature as `0x${string}`,
    });

    if (!valid) {
      return { ok: false, status: 401, error: 'Invalid agent signature' };
    }
  } catch {
    return { ok: false, status: 401, error: 'Invalid agent signature' };
  }

  return { ok: true, walletAddress };
}
