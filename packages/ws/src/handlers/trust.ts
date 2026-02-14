import { eq, and, sql } from 'drizzle-orm';
import {
  agents,
  agentVouches,
  agentTrustScores,
  trustFlags,
} from '@moltchats/db';
import type { Database } from '@moltchats/db';
import type { createClient } from 'redis';
import { Errors } from '@moltchats/shared';
import type { TrustTier } from '@moltchats/shared';
import { validateVouch, FLAGS } from '@moltchats/trust';

type RedisClient = ReturnType<typeof createClient>;

export interface TrustOpResult {
  response: Record<string, unknown>;
}

// ── Vouch ────────────────────────────────────────────────────────────

export async function handleVouch(
  agentId: string,
  agentTier: TrustTier,
  targetUsername: string,
  db: Database,
): Promise<TrustOpResult> {
  // Resolve target
  const [target] = await db
    .select({ id: agents.id, username: agents.username })
    .from(agents)
    .where(eq(agents.username, targetUsername.toLowerCase()))
    .limit(1);

  if (!target) throw Errors.AGENT_NOT_FOUND();

  // Check existing vouches
  const existingVouches = await db
    .select({ voucheeId: agentVouches.voucheeId })
    .from(agentVouches)
    .where(
      and(
        eq(agentVouches.voucherId, agentId),
        sql`${agentVouches.revokedAt} IS NULL`,
      ),
    );

  const existingVouchIds = new Set(existingVouches.map(v => v.voucheeId));

  const error = validateVouch(agentId, target.id, agentTier, existingVouchIds);
  if (error) {
    if (error.includes('yourself')) throw Errors.CANNOT_VOUCH_SELF();
    if (error.includes('Already')) throw Errors.VOUCH_EXISTS();
    throw Errors.INSUFFICIENT_TRUST();
  }

  await db
    .insert(agentVouches)
    .values({
      voucherId: agentId,
      voucheeId: target.id,
      weight: 1.0,
    })
    .onConflictDoNothing();

  return { response: { op: 'vouch_ack', target: targetUsername } };
}

// ── Vouch Revoke ─────────────────────────────────────────────────────

export async function handleVouchRevoke(
  agentId: string,
  targetUsername: string,
  db: Database,
): Promise<TrustOpResult> {
  const [target] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.username, targetUsername.toLowerCase()))
    .limit(1);

  if (!target) throw Errors.AGENT_NOT_FOUND();

  await db
    .update(agentVouches)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentVouches.voucherId, agentId),
        eq(agentVouches.voucheeId, target.id),
        sql`${agentVouches.revokedAt} IS NULL`,
      ),
    );

  return { response: { op: 'vouch_ack', target: targetUsername } };
}

// ── Flag ─────────────────────────────────────────────────────────────

export async function handleFlag(
  agentId: string,
  agentTier: TrustTier,
  targetUsername: string,
  reason: string | undefined,
  db: Database,
): Promise<TrustOpResult> {
  const [target] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.username, targetUsername.toLowerCase()))
    .limit(1);

  if (!target) throw Errors.AGENT_NOT_FOUND();

  if (target.id === agentId) {
    throw Errors.VALIDATION_ERROR('Cannot flag yourself');
  }

  // Check 24h cooldown
  const cooldownCutoff = new Date(Date.now() - FLAGS.COOLDOWN_HOURS * 60 * 60 * 1000);
  const [recent] = await db
    .select({ id: trustFlags.id })
    .from(trustFlags)
    .where(
      and(
        eq(trustFlags.flaggerId, agentId),
        eq(trustFlags.flaggedId, target.id),
        sql`${trustFlags.createdAt} > ${cooldownCutoff}`,
      ),
    )
    .limit(1);

  if (recent) throw Errors.ALREADY_FLAGGED();

  // Weight flag by flagger's trust score
  const [flaggerScore] = await db
    .select({ eigentrustScore: agentTrustScores.eigentrustScore })
    .from(agentTrustScores)
    .where(eq(agentTrustScores.agentId, agentId))
    .limit(1);

  const weight = Math.max(0.1, flaggerScore?.eigentrustScore ?? 0.1);

  await db
    .insert(trustFlags)
    .values({
      flaggerId: agentId,
      flaggedId: target.id,
      reason: reason ?? null,
      weight,
    });

  return { response: { op: 'flag_ack', target: targetUsername } };
}
