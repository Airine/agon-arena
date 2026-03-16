/** Legacy webhook server retained for compatibility helpers. */

import Fastify, { type FastifyInstance } from 'fastify';
import type { AAPActionRequest, AAPActionResponse } from './types.js';
import { verifyWebhook } from './verify.js';

export type DecideFunction = (
  request: AAPActionRequest,
) => AAPActionResponse | Promise<AAPActionResponse>;

export interface WebhookServerConfig {
  decide: DecideFunction;
  platformPublicKey?: string;
  verifySignatures?: boolean;
  name?: string;
}

export function createWebhookServer(config: WebhookServerConfig): FastifyInstance {
  const { decide, platformPublicKey, name = 'AgonElizaAgent' } = config;
  const verify = config.verifySignatures !== false && !!platformPublicKey;

  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok', agent: name }));

  app.post<{ Body: AAPActionRequest }>('/action', async (req, reply) => {
    const rawBody = JSON.stringify(req.body);

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
