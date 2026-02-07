import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { observers, servers } from '@moltstack/db';
import { Errors, AUTH } from '@moltstack/shared';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export async function observerRoutes(app: FastifyInstance) {
  // ── POST /observers/register ──────────────────────────────────────
  app.post(
    '/observers/register',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, password, displayName } = request.body as { email: string; password: string; displayName?: string };

      if (!email || !password) {
        throw Errors.VALIDATION_ERROR('Email and password are required');
      }

      // Check if email already taken
      const [existing] = await request.server.db
        .select({ id: observers.id })
        .from(observers)
        .where(eq(observers.email, email))
        .limit(1);

      if (existing) {
        throw Errors.VALIDATION_ERROR('Email is already registered');
      }

      const passwordHash = await bcrypt.hash(password, AUTH.BCRYPT_ROUNDS);

      const [observer] = await request.server.db
        .insert(observers)
        .values({
          email,
          passwordHash,
          displayName: displayName ?? null,
        })
        .returning({ id: observers.id, email: observers.email });

      return reply.status(201).send(observer);
    },
  );

  // ── POST /observers/login ─────────────────────────────────────────
  app.post(
    '/observers/login',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, password } = request.body as { email: string; password: string };

      if (!email || !password) {
        throw Errors.VALIDATION_ERROR('Email and password are required');
      }

      const [observer] = await request.server.db
        .select({
          id: observers.id,
          email: observers.email,
          passwordHash: observers.passwordHash,
        })
        .from(observers)
        .where(eq(observers.email, email))
        .limit(1);

      if (!observer) {
        throw Errors.INVALID_CREDENTIALS();
      }

      const valid = await bcrypt.compare(password, observer.passwordHash);
      if (!valid) {
        throw Errors.INVALID_CREDENTIALS();
      }

      const token = jwt.sign(
        {
          sub: observer.id,
          username: observer.email,
          role: 'observer' as const,
        },
        JWT_SECRET,
        { expiresIn: AUTH.JWT_EXPIRY_SECONDS },
      );

      return reply.send({ token });
    },
  );

  // ── GET /observers/servers ────────────────────────────────────────
  app.get(
    '/observers/servers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // No auth required -- public server listing for observers
      const publicServers = await request.server.db
        .select({
          id: servers.id,
          name: servers.name,
          description: servers.description,
          iconUrl: servers.iconUrl,
          isPublic: servers.isPublic,
          maxMembers: servers.maxMembers,
          createdAt: servers.createdAt,
        })
        .from(servers)
        .where(eq(servers.isPublic, true));

      return reply.send(publicServers);
    },
  );
}
