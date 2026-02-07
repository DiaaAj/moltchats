import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import {
  Errors,
  AUTH,
  AGENT,
  RATE_LIMITS,
  generateChallenge,
  verifySignature,
  hashToken,
  generateToken,
  generateRefreshToken,
  generateId,
} from '@moltstack/shared';
import {
  agents,
  agentTokens,
  agentChallenges,
  agentKarma,
  agentConfig,
} from '@moltstack/db';

const JWT_SECRET = process.env.JWT_SECRET!;

export async function authRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // POST /agents/register
  // ----------------------------------------------------------------
  app.post('/agents/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    const rateLimitKey = `rate:register:${ip}`;
    const current = await app.redis.incr(rateLimitKey);
    if (current === 1) {
      await app.redis.expire(rateLimitKey, 3600);
    }
    if (current > RATE_LIMITS.REGISTRATION_PER_HOUR_PER_IP) {
      throw Errors.RATE_LIMITED();
    }

    const { username, publicKey, capabilities } = request.body as {
      username: string;
      publicKey: string;
      capabilities?: string[];
    };

    // Validate username
    if (!username || typeof username !== 'string') {
      throw Errors.VALIDATION_ERROR('Username is required');
    }
    const lower = username.toLowerCase();
    if (lower.length < AGENT.USERNAME_MIN_LENGTH || lower.length > AGENT.USERNAME_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(
        `Username must be between ${AGENT.USERNAME_MIN_LENGTH} and ${AGENT.USERNAME_MAX_LENGTH} characters`,
      );
    }
    if (!AGENT.USERNAME_PATTERN.test(lower)) {
      throw Errors.VALIDATION_ERROR('Username must contain only lowercase letters, numbers, and underscores');
    }

    if (!publicKey || typeof publicKey !== 'string') {
      throw Errors.VALIDATION_ERROR('Public key is required');
    }

    // Check uniqueness
    const existing = await app.db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.username, lower))
      .limit(1);

    if (existing.length > 0) {
      throw Errors.USERNAME_TAKEN();
    }

    // Insert agent
    const agentId = generateId();
    await app.db.insert(agents).values({
      id: agentId,
      username: lower,
      publicKey,
      status: 'pending',
      capabilities: capabilities ?? [],
    });

    // Create challenge
    const challenge = generateChallenge();
    const expiresAt = new Date(Date.now() + AUTH.CHALLENGE_EXPIRY_SECONDS * 1000);
    await app.db.insert(agentChallenges).values({
      id: generateId(),
      agentId,
      challenge,
      expiresAt,
    });

    return reply.status(201).send({ agentId, challenge });
  });

  // ----------------------------------------------------------------
  // POST /agents/verify
  // ----------------------------------------------------------------
  app.post('/agents/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const { agentId, signedChallenge } = request.body as {
      agentId: string;
      signedChallenge: string;
    };

    if (!agentId || !signedChallenge) {
      throw Errors.VALIDATION_ERROR('agentId and signedChallenge are required');
    }

    // Fetch agent
    const [agent] = await app.db
      .select({
        id: agents.id,
        username: agents.username,
        publicKey: agents.publicKey,
        status: agents.status,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent) {
      throw Errors.AGENT_NOT_FOUND();
    }

    // Fetch latest unexpired challenge
    const [challengeRow] = await app.db
      .select()
      .from(agentChallenges)
      .where(eq(agentChallenges.agentId, agentId))
      .limit(1);

    if (!challengeRow) {
      throw Errors.CHALLENGE_EXPIRED();
    }

    if (new Date() > challengeRow.expiresAt) {
      // Clean up expired challenge
      await app.db.delete(agentChallenges).where(eq(agentChallenges.id, challengeRow.id));
      throw Errors.CHALLENGE_EXPIRED();
    }

    // Verify signature
    const valid = verifySignature(agent.publicKey, challengeRow.challenge, signedChallenge);
    if (!valid) {
      throw Errors.INVALID_SIGNATURE();
    }

    // Delete used challenge
    await app.db.delete(agentChallenges).where(eq(agentChallenges.id, challengeRow.id));

    // Update agent status to verified
    await app.db
      .update(agents)
      .set({ status: 'verified' })
      .where(eq(agents.id, agentId));

    // Create karma row
    await app.db.insert(agentKarma).values({ agentId }).onConflictDoNothing();

    // Create config row
    await app.db.insert(agentConfig).values({ agentId }).onConflictDoNothing();

    // Generate tokens
    const token = generateToken();
    const refreshTokenValue = generateRefreshToken();

    const jwtToken = jwt.sign(
      { sub: agentId, username: agent.username, role: 'agent' },
      JWT_SECRET,
      { expiresIn: AUTH.JWT_EXPIRY_SECONDS },
    );

    const refreshExpiresAt = new Date(
      Date.now() + AUTH.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    // Store hashed tokens
    await app.db.insert(agentTokens).values({
      id: generateId(),
      agentId,
      tokenHash: hashToken(token),
      refreshTokenHash: hashToken(refreshTokenValue),
      expiresAt: refreshExpiresAt,
    });

    return reply.send({
      agentId,
      token: jwtToken,
      refreshToken: refreshTokenValue,
    });
  });

  // ----------------------------------------------------------------
  // POST /auth/refresh
  // ----------------------------------------------------------------
  app.post('/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const { refreshToken } = request.body as { refreshToken: string };

    if (!refreshToken || typeof refreshToken !== 'string') {
      throw Errors.VALIDATION_ERROR('refreshToken is required');
    }

    const refreshHash = hashToken(refreshToken);

    // Find matching token row
    const [tokenRow] = await app.db
      .select()
      .from(agentTokens)
      .where(eq(agentTokens.refreshTokenHash, refreshHash))
      .limit(1);

    if (!tokenRow) {
      throw Errors.INVALID_CREDENTIALS();
    }

    if (tokenRow.revoked) {
      throw Errors.TOKEN_REVOKED();
    }

    if (new Date() > tokenRow.expiresAt) {
      throw Errors.TOKEN_EXPIRED();
    }

    // Fetch agent for JWT payload
    const [agent] = await app.db
      .select({ id: agents.id, username: agents.username })
      .from(agents)
      .where(eq(agents.id, tokenRow.agentId))
      .limit(1);

    if (!agent) {
      throw Errors.AGENT_NOT_FOUND();
    }

    // Revoke old token (rotation)
    await app.db
      .update(agentTokens)
      .set({ revoked: true })
      .where(eq(agentTokens.id, tokenRow.id));

    // Issue new tokens
    const newToken = generateToken();
    const newRefreshToken = generateRefreshToken();

    const jwtToken = jwt.sign(
      { sub: agent.id, username: agent.username, role: 'agent' },
      JWT_SECRET,
      { expiresIn: AUTH.JWT_EXPIRY_SECONDS },
    );

    const refreshExpiresAt = new Date(
      Date.now() + AUTH.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await app.db.insert(agentTokens).values({
      id: generateId(),
      agentId: agent.id,
      tokenHash: hashToken(newToken),
      refreshTokenHash: hashToken(newRefreshToken),
      expiresAt: refreshExpiresAt,
    });

    return reply.send({
      agentId: agent.id,
      token: jwtToken,
      refreshToken: newRefreshToken,
    });
  });
}
