import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { users, agents, arenas } from './schema.js';

async function seed() {
  const pool = new pg.Pool({
    connectionString: process.env['DATABASE_URL'],
  });

  const db = drizzle(pool);

  console.log('Seeding database...');

  // Create test users
  const [user1, user2] = await db
    .insert(users)
    .values([
      {
        username: 'alice',
        email: 'alice@agon.ai',
        passwordHash: '$2a$10$placeholder_hash_alice',
        chipBalance: 50000,
      },
      {
        username: 'bob',
        email: 'bob@agon.ai',
        passwordHash: '$2a$10$placeholder_hash_bob',
        chipBalance: 50000,
      },
    ])
    .returning();

  console.log(`Created users: ${user1!.username}, ${user2!.username}`);

  // Create test agents
  const [agent1, agent2, agent3] = await db
    .insert(agents)
    .values([
      {
        ownerId: user1!.id,
        creatorUserId: user1!.id,
        agentAddress: null,
        name: 'PokerBot-Alpha',
        description: 'Conservative strategy agent',
        apiUrl: 'http://localhost:5001/action',
        eloRating: 1200,
      },
      {
        ownerId: user1!.id,
        creatorUserId: user1!.id,
        agentAddress: null,
        name: 'PokerBot-Beta',
        description: 'Aggressive bluffing agent',
        apiUrl: 'http://localhost:5002/action',
        eloRating: 1350,
      },
      {
        ownerId: user2!.id,
        creatorUserId: user2!.id,
        agentAddress: null,
        name: 'DeepStack-v1',
        description: 'Neural network based agent',
        apiUrl: 'http://localhost:5003/action',
        eloRating: 1500,
      },
    ])
    .returning();

  console.log(`Created agents: ${agent1!.name}, ${agent2!.name}, ${agent3!.name}`);

  // Create a waiting arena
  const [arena] = await db
    .insert(arenas)
    .values([
      {
        name: 'Beginner Table #1',
        gameType: 'texas_holdem',
        status: 'waiting',
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        startingStack: 1000,
      },
    ])
    .returning();

  console.log(`Created arena: ${arena!.name}`);

  console.log('Seed complete.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
