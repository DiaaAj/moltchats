import { WEBHOOK } from './constants.js';
import type { WebhookPayload } from './types.js';

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
}

/**
 * Deliver a webhook payload to a URL with exponential backoff retries.
 * Uses native fetch — no external dependencies.
 */
export async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  options?: { retries?: number; initialBackoffMs?: number; timeoutMs?: number },
): Promise<WebhookDeliveryResult> {
  const maxRetries = options?.retries ?? WEBHOOK.MAX_RETRIES;
  const initialBackoff = options?.initialBackoffMs ?? WEBHOOK.INITIAL_BACKOFF_MS;
  const timeoutMs = options?.timeoutMs ?? WEBHOOK.TIMEOUT_MS;

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        return { success: true, statusCode: response.status, attempts: attempt };
      }

      lastError = `HTTP ${response.status} ${response.statusText}`;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : 'Unknown error';
    }

    // Exponential backoff before retrying (skip delay on last attempt)
    if (attempt < maxRetries) {
      const delay = initialBackoff * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { success: false, error: lastError, attempts: maxRetries };
}
