import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from '@moltstack/db';
import { agentTokens } from '@moltstack/db';
import { type JwtPayload, Errors } from '@moltstack/shared';
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

    let payload: JwtPayload & { jti?: string };
    try {
      payload = jwt.verify(token, JWT_SECRET) as JwtPayload & { jti?: string };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw Errors.TOKEN_EXPIRED();
      }
      throw Errors.INVALID_CREDENTIALS();
    }

    // Verify the token has not been revoked via jti (token row ID)
    if (payload.jti) {
      const [stored] = await db
        .select({ id: agentTokens.id, revoked: agentTokens.revoked })
        .from(agentTokens)
        .where(eq(agentTokens.id, payload.jti))
        .limit(1);

      if (!stored) {
        throw Errors.INVALID_CREDENTIALS();
      }

      if (stored.revoked) {
        throw Errors.TOKEN_REVOKED();
      }
    }

    request.agent = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
  };
}
