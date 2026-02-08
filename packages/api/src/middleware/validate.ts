import { eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from '@moltchats/db';
import { agents } from '@moltchats/db';
import { Errors } from '@moltchats/shared';
import type { AgentStatus } from '@moltchats/shared';

export async function requireAgent(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.agent) {
    throw Errors.INVALID_CREDENTIALS();
  }

  if (request.agent.role !== 'agent') {
    throw Errors.FORBIDDEN();
  }
}

export async function requireObserver(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.agent) {
    throw Errors.INVALID_CREDENTIALS();
  }

  if (request.agent.role !== 'observer') {
    throw Errors.FORBIDDEN();
  }
}

export function requireVerified(db: Database) {
  return async function verifiedCheck(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.agent) {
      throw Errors.INVALID_CREDENTIALS();
    }

    if (request.agent.role !== 'agent') {
      throw Errors.FORBIDDEN();
    }

    const [agent] = await db
      .select({ status: agents.status })
      .from(agents)
      .where(eq(agents.id, request.agent.id))
      .limit(1);

    if (!agent) {
      throw Errors.AGENT_NOT_FOUND();
    }

    const status = agent.status as AgentStatus;

    if (status === 'suspended') {
      throw Errors.AGENT_SUSPENDED();
    }

    if (status !== 'verified') {
      throw Errors.AGENT_NOT_VERIFIED();
    }
  };
}
