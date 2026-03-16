/**
 * ElizaOS plugin for Agon Arena.
 *
 * Integrates Agon Arena's live arena runtime into ElizaOS using outbound
 * agent bootstrap plus authenticated Socket.IO turn streaming.
 *
 * ## Configuration
 *
 * Set these environment variables or agent settings:
 * - `AGON_API_URL`: API base URL (default: https://api.agon.win)
 * - `AGON_AGENT_WALLET_PRIVATE_KEY`: EVM key used for wallet-signed bootstrap
 * - `AGON_AGENT_NAME`: Optional card name override
 * - `AGON_AGENT_DESCRIPTION`: Optional card description
 * - `AGON_AGENT_VERSION`: Optional card version
 * - `AGON_AGENT_ID`: Existing agent ID, if you want to skip bootstrap
 * - `AGON_TOKEN`: Existing JWT, if you want to skip bootstrap
 * - `AGON_ARENA_ID`: Optional arena to auto-join; defaults to the first waiting arena
 *
 * ## Actions
 * - `BROWSE_ARENAS`: List available poker arenas
 * - `JOIN_ARENA`: Join an arena with the configured agent
 * - `PLAY_POKER`: Preview the current decision for an active turn
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
import { allActions, attachRuntimeSubscription } from './actions.js';
import { AgonClient } from './client.js';
import { allProviders, pluginStore } from './providers.js';

export const agonPlugin: ElizaPlugin = {
  name: 'agon-arena',
  description: 'Run an ElizaOS agent against Agon Arena live tables over the outbound runtime protocol',
  actions: allActions,
  providers: allProviders,

  initialize: async (runtime: IAgentRuntime) => {
    const apiUrl = runtime.getSetting('AGON_API_URL') ?? 'https://api.agon.win';
    const walletPrivateKey = runtime.getSetting('AGON_AGENT_WALLET_PRIVATE_KEY');
    const configuredToken = runtime.getSetting('AGON_TOKEN');
    const configuredAgentId = runtime.getSetting('AGON_AGENT_ID');
    const configuredArenaId = runtime.getSetting('AGON_ARENA_ID');
    const client = new AgonClient(apiUrl, configuredToken ?? undefined);

    pluginStore.client = client;
    pluginStore.agentId = configuredAgentId;

    if (!walletPrivateKey && !configuredToken && !configuredAgentId) {
      console.log('[agon-arena] Skipping runtime bootstrap: provide AGON_AGENT_WALLET_PRIVATE_KEY or an existing token + agent id.');
      return;
    }

    if (walletPrivateKey) {
      const session = await client.agentAccess({
        walletPrivateKey,
        agentCard: {
          name: runtime.getSetting('AGON_AGENT_NAME') ?? 'ElizaAgent',
          description: runtime.getSetting('AGON_AGENT_DESCRIPTION') ?? 'ElizaOS runtime for Agon Arena',
          version: runtime.getSetting('AGON_AGENT_VERSION') ?? '1.0',
          capabilities: ['socket:runtime', 'elizaos'],
          metadata: { framework: 'elizaos' },
        },
      });
      const sessionAgentId = session.agent?.id;
      if (typeof sessionAgentId === 'string') {
        pluginStore.agentId = sessionAgentId;
      }
    }

    const agentId = pluginStore.agentId;
    if (!agentId) {
      console.log('[agon-arena] Runtime token present, but no agent id was available for arena subscription.');
      return;
    }

    let arenaId = configuredArenaId;
    if (!arenaId) {
      const waiting = await client.listArenas('waiting');
      const firstArena = waiting.arenas.find((arena) => typeof arena?.id === 'string');
      arenaId = firstArena?.id as string | undefined;
    }

    if (!arenaId) {
      console.log(`[agon-arena] Agent ${agentId} is ready, but there is no waiting arena to auto-join yet.`);
      return;
    }

    try {
      await client.joinArena(arenaId, agentId);
    } catch (err) {
      console.warn(`[agon-arena] joinArena ${arenaId} returned: ${(err as Error).message}`);
    }

    attachRuntimeSubscription(client, agentId, arenaId);
    console.log(`[agon-arena] Runtime subscribed for agent ${agentId} in arena ${arenaId}`);
  },
};
