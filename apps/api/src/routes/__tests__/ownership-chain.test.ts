/**
 * AGO-53: Owner-Agent ownership chain binding (max depth 5 levels).
 *
 * Validates:
 *  1. EIP-191 bind-owner signature construction and verification
 *  2. Chain depth enforcement (max 5 levels)
 *  3. Circular dependency detection
 *  4. Nonce single-use enforcement for bind operations
 *  5. Binding overwrites existing owner (rebind allowed)
 *  6. Ownership chain traversal logic
 *
 * Runs in-process without live DB or Redis.
 *
 * Run with: pnpm --filter @agon/api test -- ownership-chain
 */
import { describe, it, expect } from 'vitest';
import { createWalletClient, http, verifyMessage } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { randomBytes } from 'crypto';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OWNERSHIP_DEPTH = 5;

// ---------------------------------------------------------------------------
// Helpers (mirrors production code)
// ---------------------------------------------------------------------------

function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

/** The exact message format owner must sign (mirrors auth.ts) */
function buildBindMessage(ownerWalletAddress: string, agentWalletAddress: string, nonce: string): string {
  return `Bind Agent\nOwner: ${ownerWalletAddress}\nAgent: ${agentWalletAddress}\nNonce: ${nonce}`;
}

async function signBindMessage(
  privateKey: `0x${string}`,
  ownerWalletAddress: string,
  agentWalletAddress: string,
  nonce: string,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain: baseSepolia, transport: http() });
  return client.signMessage({ message: buildBindMessage(ownerWalletAddress, agentWalletAddress, nonce) });
}

// ---------------------------------------------------------------------------
// In-memory nonce store — simulates Redis (mirrors redis.ts pattern)
// ---------------------------------------------------------------------------

class BindNonceStore {
  private nonces = new Set<string>();
  store(nonce: string): void { this.nonces.add(nonce); }
  consume(nonce: string): boolean {
    if (this.nonces.has(nonce)) {
      this.nonces.delete(nonce);
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory agent store — simulates DB for ownership chain logic
// ---------------------------------------------------------------------------

interface AgentRecord {
  id: string;
  name: string;
  walletAddress: string;
  ownerAgentId: string | null;
}

class AgentStore {
  private agents = new Map<string, AgentRecord>();

  create(walletAddress: string, name: string): AgentRecord {
    const id = randomBytes(16).toString('hex');
    const record: AgentRecord = { id, name, walletAddress, ownerAgentId: null };
    this.agents.set(id, record);
    return record;
  }

  get(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  setOwner(agentId: string, ownerAgentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) agent.ownerAgentId = ownerAgentId;
  }

  /** Compute chain depth from agentId to root (0 = no parent). Cycle-safe. */
  chainDepth(agentId: string): number {
    const visited = new Set<string>();
    let depth = 0;
    let current: string | null = agentId;
    while (current) {
      if (visited.has(current)) return MAX_OWNERSHIP_DEPTH + 1; // cycle sentinel
      visited.add(current);
      const agent = this.agents.get(current);
      current = agent?.ownerAgentId ?? null;
      if (current) depth++;
    }
    return depth;
  }

  /** Check if potentialAncestorId is an ancestor of targetId (cycle detection). */
  isAncestor(potentialAncestorId: string, targetId: string): boolean {
    const visited = new Set<string>();
    let current: string | null = targetId;
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      if (current === potentialAncestorId) return true;
      current = this.agents.get(current)?.ownerAgentId ?? null;
    }
    return false;
  }

  /** Get full ownership chain from agentId up to root. */
  getChain(agentId: string): AgentRecord[] {
    const chain: AgentRecord[] = [];
    const visited = new Set<string>();
    let current: string | null = agentId;
    while (current) {
      if (visited.has(current)) break; // stop on cycle
      visited.add(current);
      const agent = this.agents.get(current);
      if (!agent) break;
      chain.push(agent);
      current = agent.ownerAgentId;
    }
    return chain;
  }

  /**
   * Bind child to owner — mirrors the production bind-owner handler logic.
   * Returns error string or null on success.
   */
  bind(childId: string, ownerId: string): string | null {
    if (childId === ownerId) return 'Agent cannot own itself';

    const ownerDepth = this.chainDepth(ownerId);
    if (ownerDepth >= MAX_OWNERSHIP_DEPTH + 1) return 'Circular ownership detected';
    if (ownerDepth + 1 >= MAX_OWNERSHIP_DEPTH) {
      return `Ownership chain would exceed maximum depth of ${MAX_OWNERSHIP_DEPTH}`;
    }
    if (this.isAncestor(childId, ownerId)) return 'Circular ownership detected';

    this.setOwner(childId, ownerId);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Zod schema (mirrors production)
// ---------------------------------------------------------------------------

const bindOwnerSchema = z.object({
  agentId: z.string().uuid(),
  ownerAgentId: z.string().uuid(),
  nonce: z.string().min(1),
  signature: z.string().startsWith('0x'),
});

// ---------------------------------------------------------------------------
// 1. EIP-191 bind signature
// ---------------------------------------------------------------------------

describe('EIP-191 bind-owner signature', () => {
  it('verifies correctly with matching owner address', async () => {
    const ownerKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerKey);
    const agentAddress = privateKeyToAccount(generatePrivateKey()).address;
    const nonce = generateNonce();

    const sig = await signBindMessage(ownerKey, ownerAccount.address, agentAddress, nonce);

    const valid = await verifyMessage({
      address: ownerAccount.address,
      message: buildBindMessage(ownerAccount.address, agentAddress, nonce),
      signature: sig,
    });
    expect(valid).toBe(true);
  });

  it('rejects when claimed owner address does not match actual signer', async () => {
    const ownerKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerKey);
    const impersonatorAccount = privateKeyToAccount(generatePrivateKey());
    const agentAddress = privateKeyToAccount(generatePrivateKey()).address;
    const nonce = generateNonce();

    const sig = await signBindMessage(ownerKey, ownerAccount.address, agentAddress, nonce);

    const valid = await verifyMessage({
      address: impersonatorAccount.address, // wrong address
      message: buildBindMessage(ownerAccount.address, agentAddress, nonce),
      signature: sig,
    });
    expect(valid).toBe(false);
  });

  it('rejects when agent address in message is tampered', async () => {
    const ownerKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerKey);
    const agentAddress = privateKeyToAccount(generatePrivateKey()).address;
    const tamperedAgentAddress = privateKeyToAccount(generatePrivateKey()).address;
    const nonce = generateNonce();

    const sig = await signBindMessage(ownerKey, ownerAccount.address, agentAddress, nonce);

    const valid = await verifyMessage({
      address: ownerAccount.address,
      message: buildBindMessage(ownerAccount.address, tamperedAgentAddress, nonce), // tampered
      signature: sig,
    });
    expect(valid).toBe(false);
  });

  it('rejects when nonce is tampered', async () => {
    const ownerKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerKey);
    const agentAddress = privateKeyToAccount(generatePrivateKey()).address;
    const nonce = generateNonce();
    const tamperedNonce = generateNonce();

    const sig = await signBindMessage(ownerKey, ownerAccount.address, agentAddress, nonce);

    const valid = await verifyMessage({
      address: ownerAccount.address,
      message: buildBindMessage(ownerAccount.address, agentAddress, tamperedNonce),
      signature: sig,
    });
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Nonce single-use enforcement
// ---------------------------------------------------------------------------

describe('Bind nonce single-use enforcement', () => {
  it('allows nonce consumption exactly once', () => {
    const store = new BindNonceStore();
    const nonce = generateNonce();
    store.store(nonce);

    expect(store.consume(nonce)).toBe(true);
    expect(store.consume(nonce)).toBe(false); // replay rejected
  });

  it('rejects unknown nonce (never stored)', () => {
    const store = new BindNonceStore();
    expect(store.consume(generateNonce())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Chain depth enforcement
// ---------------------------------------------------------------------------

describe('Ownership chain depth enforcement', () => {
  function makeAddress(): string {
    return privateKeyToAccount(generatePrivateKey()).address;
  }

  it('allows binding at depth 1 (direct owner)', () => {
    const store = new AgentStore();
    const owner = store.create(makeAddress(), 'Owner');
    const child = store.create(makeAddress(), 'Child');

    const err = store.bind(child.id, owner.id);
    expect(err).toBeNull();
    expect(store.get(child.id)?.ownerAgentId).toBe(owner.id);
  });

  it('allows a chain of exactly 5 levels', () => {
    // A1 → A2 → A3 → A4 → A5 (depth = 4 from A5 up to A1)
    const store = new AgentStore();
    const agents = Array.from({ length: 5 }, (_, i) =>
      store.create(makeAddress(), `Agent${i + 1}`),
    );

    // Bind in order: A2 owned by A1, A3 by A2, A4 by A3, A5 by A4
    expect(store.bind(agents[1]!.id, agents[0]!.id)).toBeNull(); // depth 1
    expect(store.bind(agents[2]!.id, agents[1]!.id)).toBeNull(); // depth 2
    expect(store.bind(agents[3]!.id, agents[2]!.id)).toBeNull(); // depth 3
    expect(store.bind(agents[4]!.id, agents[3]!.id)).toBeNull(); // depth 4

    // Chain from A5: A5 → A4 → A3 → A2 → A1 = 5 agents = depth 4 hops
    const chain = store.getChain(agents[4]!.id);
    expect(chain.length).toBe(5);
  });

  it('rejects binding that would exceed depth 5', () => {
    const store = new AgentStore();
    const agents = Array.from({ length: 6 }, (_, i) =>
      store.create(makeAddress(), `Agent${i + 1}`),
    );

    // Build chain A1 → A2 → A3 → A4 → A5 (4 hops, depth 5)
    store.bind(agents[1]!.id, agents[0]!.id);
    store.bind(agents[2]!.id, agents[1]!.id);
    store.bind(agents[3]!.id, agents[2]!.id);
    store.bind(agents[4]!.id, agents[3]!.id);

    // Trying to bind A6 to A5 would make chain depth 6 → rejected
    const err = store.bind(agents[5]!.id, agents[4]!.id);
    expect(err).toBeTruthy();
    expect(err).toContain('exceed maximum depth');
  });
});

// ---------------------------------------------------------------------------
// 4. Circular dependency detection
// ---------------------------------------------------------------------------

describe('Circular ownership detection', () => {
  function makeAddress(): string {
    return privateKeyToAccount(generatePrivateKey()).address;
  }

  it('rejects self-ownership', () => {
    const store = new AgentStore();
    const agent = store.create(makeAddress(), 'Solo');
    const err = store.bind(agent.id, agent.id);
    expect(err).toBeTruthy();
    expect(err).toContain('cannot own itself');
  });

  it('rejects direct cycle: A → B, then B → A', () => {
    const store = new AgentStore();
    const a = store.create(makeAddress(), 'A');
    const b = store.create(makeAddress(), 'B');

    expect(store.bind(a.id, b.id)).toBeNull(); // A owned by B
    const err = store.bind(b.id, a.id);        // B tries to be owned by A → cycle
    expect(err).toBeTruthy();
    expect(err).toContain('Circular');
  });

  it('rejects indirect cycle: A → B → C, then C → A', () => {
    const store = new AgentStore();
    const a = store.create(makeAddress(), 'A');
    const b = store.create(makeAddress(), 'B');
    const c = store.create(makeAddress(), 'C');

    expect(store.bind(a.id, b.id)).toBeNull(); // A owned by B
    expect(store.bind(b.id, c.id)).toBeNull(); // B owned by C → chain: A→B→C
    const err = store.bind(c.id, a.id);        // C tries to be owned by A → cycle A→B→C→A
    expect(err).toBeTruthy();
    expect(err).toContain('Circular');
  });
});

// ---------------------------------------------------------------------------
// 5. Rebind (overwrite existing owner)
// ---------------------------------------------------------------------------

describe('Ownership rebind', () => {
  function makeAddress(): string {
    return privateKeyToAccount(generatePrivateKey()).address;
  }

  it('allows rebinding to a different owner (overwrites)', () => {
    const store = new AgentStore();
    const owner1 = store.create(makeAddress(), 'Owner1');
    const owner2 = store.create(makeAddress(), 'Owner2');
    const child = store.create(makeAddress(), 'Child');

    expect(store.bind(child.id, owner1.id)).toBeNull();
    expect(store.get(child.id)?.ownerAgentId).toBe(owner1.id);

    expect(store.bind(child.id, owner2.id)).toBeNull();
    expect(store.get(child.id)?.ownerAgentId).toBe(owner2.id);
  });
});

// ---------------------------------------------------------------------------
// 6. Ownership chain traversal
// ---------------------------------------------------------------------------

describe('Ownership chain traversal', () => {
  function makeAddress(): string {
    return privateKeyToAccount(generatePrivateKey()).address;
  }

  it('returns single-element chain for agent with no owner', () => {
    const store = new AgentStore();
    const a = store.create(makeAddress(), 'Lone');
    const chain = store.getChain(a.id);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.id).toBe(a.id);
  });

  it('returns full chain in order from child to root', () => {
    const store = new AgentStore();
    const root = store.create(makeAddress(), 'Root');
    const mid = store.create(makeAddress(), 'Mid');
    const leaf = store.create(makeAddress(), 'Leaf');

    store.bind(mid.id, root.id);  // mid owned by root
    store.bind(leaf.id, mid.id);  // leaf owned by mid

    const chain = store.getChain(leaf.id);
    expect(chain).toHaveLength(3);
    expect(chain[0]!.id).toBe(leaf.id);
    expect(chain[1]!.id).toBe(mid.id);
    expect(chain[2]!.id).toBe(root.id);
  });

  it('depth equals chain length minus 1', () => {
    const store = new AgentStore();
    const agents = Array.from({ length: 4 }, (_, i) =>
      store.create(makeAddress(), `A${i}`),
    );
    store.bind(agents[1]!.id, agents[0]!.id);
    store.bind(agents[2]!.id, agents[1]!.id);
    store.bind(agents[3]!.id, agents[2]!.id);

    const chain = store.getChain(agents[3]!.id);
    expect(chain.length).toBe(4);
    expect(store.chainDepth(agents[3]!.id)).toBe(chain.length - 1);
  });
});

// ---------------------------------------------------------------------------
// 7. Zod schema validation
// ---------------------------------------------------------------------------

describe('bindOwner schema validation', () => {
  it('accepts valid payload', () => {
    const result = bindOwnerSchema.safeParse({
      agentId: '00000000-0000-0000-0000-000000000001',
      ownerAgentId: '00000000-0000-0000-0000-000000000002',
      nonce: generateNonce(),
      signature: '0xdeadbeef',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID agentId', () => {
    const result = bindOwnerSchema.safeParse({
      agentId: 'not-a-uuid',
      ownerAgentId: '00000000-0000-0000-0000-000000000002',
      nonce: generateNonce(),
      signature: '0xdeadbeef',
    });
    expect(result.success).toBe(false);
  });

  it('rejects signature without 0x prefix', () => {
    const result = bindOwnerSchema.safeParse({
      agentId: '00000000-0000-0000-0000-000000000001',
      ownerAgentId: '00000000-0000-0000-0000-000000000002',
      nonce: generateNonce(),
      signature: 'deadbeef',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Full simulated happy-path flow
// ---------------------------------------------------------------------------

describe('Simulated bind-owner flow', () => {
  it('full happy path: sign → verify → nonce consumed → owner set', async () => {
    const ownerKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerKey);
    const agentAccount = privateKeyToAccount(generatePrivateKey());
    const nonceStore = new BindNonceStore();
    const agentStore = new AgentStore();

    const owner = agentStore.create(ownerAccount.address, 'OwnerBot');
    const child = agentStore.create(agentAccount.address, 'ChildBot');

    // Step 1: Server generates and stores nonce
    const nonce = generateNonce();
    nonceStore.store(nonce);

    // Step 2: Owner signs bind message
    const sig = await signBindMessage(ownerKey, ownerAccount.address, agentAccount.address, nonce);

    // Step 3: Server verifies owner's signature
    const valid = await verifyMessage({
      address: ownerAccount.address,
      message: buildBindMessage(ownerAccount.address, agentAccount.address, nonce),
      signature: sig,
    });
    expect(valid).toBe(true);

    // Step 4: Consume nonce (single-use)
    expect(nonceStore.consume(nonce)).toBe(true);

    // Step 5: Apply binding (no cycle, depth OK)
    const err = agentStore.bind(child.id, owner.id);
    expect(err).toBeNull();

    // Step 6: Verify chain
    const chain = agentStore.getChain(child.id);
    expect(chain).toHaveLength(2);
    expect(chain[0]!.id).toBe(child.id);
    expect(chain[1]!.id).toBe(owner.id);
  });

  it('replay attack: second bind with same nonce is rejected', async () => {
    const ownerKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerKey);
    const agentAccount = privateKeyToAccount(generatePrivateKey());
    const nonceStore = new BindNonceStore();

    const nonce = generateNonce();
    nonceStore.store(nonce);

    const sig = await signBindMessage(ownerKey, ownerAccount.address, agentAccount.address, nonce);
    const message = buildBindMessage(ownerAccount.address, agentAccount.address, nonce);

    // First attempt: succeeds
    const valid1 = await verifyMessage({ address: ownerAccount.address, message, signature: sig });
    expect(valid1).toBe(true);
    expect(nonceStore.consume(nonce)).toBe(true);

    // Second attempt (replay): nonce already consumed
    const valid2 = await verifyMessage({ address: ownerAccount.address, message, signature: sig });
    expect(valid2).toBe(true); // crypto still valid
    expect(nonceStore.consume(nonce)).toBe(false); // nonce rejected
  });
});
