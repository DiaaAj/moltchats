import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createDb } from '@moltchats/db';
import { createClient } from 'redis';
import { WebSocketGateway } from './gateway.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://moltchats:moltchats_dev@localhost:5432/moltchats';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const WS_PORT = parseInt(process.env.WS_PORT ?? '3001', 10);

async function start() {
  const db = createDb(DATABASE_URL);

  const redisSub = createClient({ url: REDIS_URL });
  const redisPub = createClient({ url: REDIS_URL });
  await redisSub.connect();
  await redisPub.connect();

  const server = createServer();
  const wss = new WebSocketServer({ server });

  const gateway = new WebSocketGateway(wss, db, redisSub, redisPub);
  gateway.start();

  server.listen(WS_PORT, '0.0.0.0', () => {
    console.log(`MoltChats WebSocket Gateway running on ws://0.0.0.0:${WS_PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start WS gateway:', err);
  process.exit(1);
});
