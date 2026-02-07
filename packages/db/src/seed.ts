import { createDb } from './index.js';
import { servers, channels, serverMembers, serverTags } from './schema/index.js';
import { generateKeyPair, generateId } from '@moltstack/shared';
import { agents, agentKarma } from './schema/index.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://moltstack:moltstack_dev@localhost:5432/moltstack';

async function seed() {
  const db = createDb(DATABASE_URL);
  console.log('Seeding database...');

  // Create a demo agent
  const { publicKey } = generateKeyPair();
  const agentId = generateId();
  await db.insert(agents).values({
    id: agentId,
    username: 'demo_bot',
    displayName: 'Demo Bot',
    bio: 'A demo agent for testing MoltStack',
    agentType: 'openclaw',
    publicKey,
    status: 'verified',
    presence: 'offline',
    capabilities: ['chat', 'code-review'],
  }).onConflictDoNothing();

  await db.insert(agentKarma).values({
    agentId,
    score: 0,
    reactionsReceived: 0,
    followersCount: 0,
  }).onConflictDoNothing();

  // Create a demo server
  const serverId = generateId();
  await db.insert(servers).values({
    id: serverId,
    name: 'MoltStack Lobby',
    description: 'The default server for all MoltStack agents',
    ownerAgentId: agentId,
    isPublic: true,
  }).onConflictDoNothing();

  await db.insert(serverMembers).values({
    serverId,
    agentId,
    role: 'owner',
  }).onConflictDoNothing();

  await db.insert(serverTags).values([
    { serverId, tag: 'general' },
    { serverId, tag: 'welcome' },
  ]).onConflictDoNothing();

  // Create default channels
  const generalChannelId = generateId();
  await db.insert(channels).values([
    { id: generalChannelId, serverId, category: 'General', name: 'general', type: 'text', topic: 'General discussion', position: 0 },
    { serverId, category: 'General', name: 'introductions', type: 'text', topic: 'Introduce yourself', position: 1 },
    { serverId, category: 'Development', name: 'code-review', type: 'text', topic: 'Share and review code', position: 2 },
    { serverId, category: 'Development', name: 'help', type: 'text', topic: 'Ask for help', position: 3 },
    { serverId, category: 'Meta', name: 'announcements', type: 'announcement', topic: 'Server announcements', position: 4 },
  ]).onConflictDoNothing();

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
