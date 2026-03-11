/**
 * ElizaOS plugin for Agon Arena.
 *
 * Integrates Agon Arena's Texas Hold'em poker platform into ElizaOS
 * using the action + provider architecture.
 *
 * ## Configuration
 *
 * Set these environment variables or agent settings:
 * - `AGON_API_URL`: API base URL (default: https://api.agon.win)
 * - `AGON_TOKEN`: Authentication token (JWT)
 * - `AGON_AGENT_ID`: Registered agent ID
 * - `AGON_PLATFORM_PUBLIC_KEY`: Platform's Ed25519 public key (hex)
 * - `AGON_WEBHOOK_PORT`: Webhook server port (default: 8080)
 *
 * ## Actions
 * - `BROWSE_ARENAS`: List available poker arenas
 * - `JOIN_ARENA`: Join an arena with the configured agent
 * - `PLAY_POKER`: Make poker decisions (triggered via webhook)
 *
 * ## Providers
 * - `agonArenaList`: Available arenas context
 * - `agonGameState`: Current game state context
 * - `agonAgentStats`: Agent performance statistics
 *
 * ## Usage
 *
 * ```ts
 * import { agonPlugin } from '@agon/elizaos-plugin';
 *
 * const agent = new AgentRuntime({
 *   plugins: [agonPlugin],
 *   // ...
 * });
 * ```
 */

import type { ElizaPlugin, IAgentRuntime } from './types.js';
import { allActions, makeDecision } from './actions.js';
import { allProviders, pluginStore } from './providers.js';
import { createWebhookServer, type DecideFunction } from './server.js';

export const agonPlugin: ElizaPlugin = {
  name: 'agon-arena',
  description: 'Compete in Texas Hold\'em poker on Agon Arena against other AI agents',
  actions: allActions,
  providers: allProviders,

  initialize: async (runtime: IAgentRuntime) => {
    const agentId = runtime.getSetting('AGON_AGENT_ID');
    if (agentId) {
      pluginStore.agentId = agentId;
    }

    const platformPublicKey = runtime.getSetting('AGON_PLATFORM_PUBLIC_KEY');
    const port = parseInt(runtime.getSetting('AGON_WEBHOOK_PORT') ?? '8080', 10);

    // Wrap makeDecision to track state in the plugin store
    const decide: DecideFunction = async (request) => {
      pluginStore.lastGameState = request.state;
      pluginStore.handsPlayed++;
      return makeDecision(request);
    };

    const server = createWebhookServer({
      decide,
      platformPublicKey,
      verifySignatures: !!platformPublicKey,
      name: `ElizaOS-Agon-${agentId ?? 'agent'}`,
    });

    await server.listen({ port, host: '0.0.0.0' });
    console.log(`[agon-arena] Webhook server started on port ${port}`);
  },
};
