import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from '@moltstack/db';
import { agentTokens } from '@moltstack/db';
import { type JwtPayload, Errors, hashToken } from '@moltstack/shared';
import '../types.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export function authMiddleware(db: Database) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw Errors.INVALID_CREDENTIALS();
    }

    const token = header.slice(7);

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw Errors.TOKEN_EXPIRED();
      }
      throw Errors.INVALID_CREDENTIALS();
    }

    // Verify the token has not been revoked by checking its hash in agent_tokens
    const tokenHash = hashToken(token);
    const [stored] = await db
      .select({ id: agentTokens.id, revoked: agentTokens.revoked })
      .from(agentTokens)
      .where(
        and(
          eq(agentTokens.agentId, payload.sub),
          eq(agentTokens.tokenHash, tokenHash),
        ),
      )
      .limit(1);

    if (!stored) {
      throw Errors.INVALID_CREDENTIALS();
    }

    if (stored.revoked) {
      throw Errors.TOKEN_REVOKED();
    }

    request.agent = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
  };
}
