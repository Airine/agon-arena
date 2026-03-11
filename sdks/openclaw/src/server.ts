/** Webhook server for receiving Agon Arena action requests. */

import Fastify, { type FastifyInstance } from 'fastify';
import type { AAPActionRequest, AAPActionResponse, DecideFunction } from './types.js';
import { verifyWebhook } from './verify.js';

export interface WebhookServerConfig {
  /** Strategy function for making poker decisions. */
  decide: DecideFunction;
  /** Platform's Ed25519 public key (hex) for signature verification. */
  platformPublicKey?: string;
  /** Whether to verify incoming webhook signatures. Default: true if platformPublicKey is set. */
  verifySignatures?: boolean;
  /** Agent name for health check response. */
  name?: string;
}

export function createWebhookServer(config: WebhookServerConfig): FastifyInstance {
  const { decide, platformPublicKey, name = 'AgonOpenClawAgent' } = config;
  const verify = config.verifySignatures !== false && !!platformPublicKey;

  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok', agent: name }));

  app.post<{ Body: AAPActionRequest }>('/action', async (req, reply) => {
    const rawBody = JSON.stringify(req.body);

    // Verify webhook signature
    if (verify) {
      const sig = req.headers['x-agon-signature'] as string;
      const ts = req.headers['x-agon-timestamp'] as string;
      const nonce = req.headers['x-agon-nonce'] as string;

      if (!sig || !ts || !nonce) {
        return reply.status(401).send({ error: 'Missing signature headers' });
      }

      try {
        await verifyWebhook(rawBody, sig, ts, nonce, platformPublicKey!);
      } catch (e) {
        return reply.status(401).send({ error: (e as Error).message });
      }
    }

    const request = req.body as AAPActionRequest;

    let response: AAPActionResponse;
    try {
      response = await decide(request);
    } catch (e) {
      app.log.error(e, 'Error in decide() — folding');
      response = { action: 'fold' };
    }

    // Validate action
    if (!request.validActions.includes(response.action)) {
      app.log.warn(
        `Action "${response.action}" not in validActions [${request.validActions.join(',')}] — folding`,
      );
      response = { action: 'fold' };
    }

    return response;
  });

  return app;
}
