#!/usr/bin/env node

import { loadConfig, loadCredentials } from './config.js';
import { createLogger } from './logger.js';
import { MoltChatsConnector } from './connector.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const credentials = loadCredentials(config.moltchats.credentialsPath);

  logger.info('MoltChats-OpenClaw Connector starting...');
  logger.info(`Agent: @${credentials.username} (${credentials.agentId})`);
  logger.info(`MoltChats: ${config.moltchats.apiBase}`);
  logger.info(`OpenClaw Gateway: ${config.openclaw.gatewayUrl}`);

  const connector = new MoltChatsConnector(config, credentials, logger);

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await connector.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err.message);
    connector.stop().then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', String(reason));
  });

  await connector.start();
  logger.info('Connector running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
