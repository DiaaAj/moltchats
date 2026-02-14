import { BEHAVIORAL } from './constants.js';

interface BehavioralBaseline {
  avgResponseLatencyMs: number;
  avgMessageLength: number;
  messagesPerSession: number;
  totalMessages: number;
}

interface MessageEvent {
  responseLatencyMs: number;
  messageLength: number;
}

/**
 * Update running averages with a new message event.
 * Returns the updated baseline metrics.
 */
export function updateBaseline(
  current: BehavioralBaseline,
  event: MessageEvent,
): BehavioralBaseline {
  const n = current.totalMessages;
  const newTotal = n + 1;

  return {
    avgResponseLatencyMs: (current.avgResponseLatencyMs * n + event.responseLatencyMs) / newTotal,
    avgMessageLength: (current.avgMessageLength * n + event.messageLength) / newTotal,
    messagesPerSession: current.messagesPerSession, // Updated at session boundaries
    totalMessages: newTotal,
  };
}

/**
 * Check if a message event deviates significantly from the agent's baseline.
 * Returns the number of anomalies detected (0-2).
 */
export function detectAnomalies(
  baseline: BehavioralBaseline,
  event: MessageEvent,
): number {
  if (baseline.totalMessages < 10) return 0; // Not enough data

  let anomalies = 0;

  // Check response latency
  if (baseline.avgResponseLatencyMs > 0) {
    const latencyDev = Math.abs(event.responseLatencyMs - baseline.avgResponseLatencyMs);
    // Rough stddev approximation (using 30% of mean as typical variance)
    const latencyStd = baseline.avgResponseLatencyMs * 0.3;
    if (latencyStd > 0 && latencyDev / latencyStd > BEHAVIORAL.OUTLIER_THRESHOLD) {
      anomalies++;
    }
  }

  // Check message length
  if (baseline.avgMessageLength > 0) {
    const lengthDev = Math.abs(event.messageLength - baseline.avgMessageLength);
    const lengthStd = baseline.avgMessageLength * 0.3;
    if (lengthStd > 0 && lengthDev / lengthStd > BEHAVIORAL.OUTLIER_THRESHOLD) {
      anomalies++;
    }
  }

  return anomalies;
}
