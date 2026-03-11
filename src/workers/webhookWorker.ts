import { webhookStore } from '../store';
import { WebhookEvent } from '../types';

// How often the worker checks for pending webhooks (in milliseconds).
// NOTE: 5 seconds is fine for a mock. Real gateways use a message queue
// (e.g. RabbitMQ, AWS SQS) instead of polling — but the concept is identical.
const POLLING_INTERVAL_MS = 5000;

// Maximum delivery attempts before giving up on a webhook.
// NOTE: This is called a "dead letter" threshold — after this many failures,
// the event is considered undeliverable and gets dropped.
// Real gateways (like Stripe) retry for up to 3 days with exponential backoff.
const MAX_ATTEMPTS = 5;

// Attempts to deliver a single webhook event to the merchant's endpoint.
// ASYNC: Makes an actual HTTP POST to the merchant's webhookUrl.
async function deliverWebhook(event: WebhookEvent): Promise<void> {

  // Increment attempt count BEFORE trying — this way if the process crashes
  // mid-delivery, we don't retry infinitely thinking it was never attempted.
  webhookStore.incrementAttempts(event.id);

  try {
    // Make an HTTP POST to the merchant's webhook URL with the event payload.
    // NOTE: We use the native fetch API (available in Node 18+).
    // In older Node versions you'd use 'node-fetch' or 'axios'.
    const response = await fetch(event.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // SECURITY: In production, include a webhook signature header so
        // merchants can verify the request actually came from us —
        // not from a malicious third party spoofing our webhook.
        // e.g. 'X-Webhook-Signature': generateSignature(event)
        'X-Gateway-Event': event.type,
        'X-Gateway-Event-Id': event.id,
      },
      body: JSON.stringify({
        id: event.id,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      }),
      // Timeout after 10 seconds — don't wait forever for a slow merchant server
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      // Delivery succeeded — remove from pending queue
      // NOTE: response.ok means status code was 2xx
      console.log(`[Webhook] ✓ Delivered ${event.type} to ${event.webhookUrl} (attempt ${event.attempts + 1})`);
      webhookStore.markDelivered(event.id);
    } else {
      // Merchant server responded but with a non-2xx status (e.g. 500, 404)
      // NOTE: We log this but don't throw — the attempt was already incremented
      // and the worker will retry on the next polling cycle
      console.warn(`[Webhook] ✗ Failed to deliver ${event.id} — server responded with ${response.status}`);
    }

  } catch (err) {
    // Network error, timeout, or DNS failure — merchant server unreachable
    // NOTE: We catch here so one failed delivery doesn't crash the entire worker
    console.error(`[Webhook] ✗ Error delivering ${event.id}: ${(err as Error).message}`);
  }
}

// Processes all pending webhook events in one polling cycle.
// Called every POLLING_INTERVAL_MS by the worker loop.
async function processPendingWebhooks(): Promise<void> {
  // Get all events that haven't been successfully delivered yet
  const pending = webhookStore.findPending();

  // Nothing to do this cycle
  if (pending.length === 0) return;

  console.log(`[Webhook] Processing ${pending.length} pending event(s)...`);

  // Attempt to deliver all pending webhooks concurrently.
  // NOTE: Promise.allSettled (unlike Promise.all) continues even if
  // some deliveries fail — we want to attempt ALL of them every cycle.
  await Promise.allSettled(
    pending.map(event => {
      // Skip events that have exceeded max attempts
      if (event.attempts >= MAX_ATTEMPTS) {
        console.error(`[Webhook] ✗ Event ${event.id} exceeded max attempts (${MAX_ATTEMPTS}). Dropping.`);
        // Remove from store so we stop trying
        webhookStore.markDelivered(event.id);
        return Promise.resolve();
      }

      return deliverWebhook(event);
    })
  );
}

// Starts the webhook worker — kicks off the polling loop.
// Called once from index.ts when the server starts.
// NOTE: setInterval runs processPendingWebhooks every POLLING_INTERVAL_MS
// regardless of how long each cycle takes. For a production system you'd
// want to wait for each cycle to complete before scheduling the next
// (to avoid overlapping cycles) — but for our mock this is fine.
export function startWebhookWorker(): void {
  console.log(`[Webhook] Worker started. Polling every ${POLLING_INTERVAL_MS / 1000}s`);

  // Run once immediately on startup — don't wait for the first interval
  processPendingWebhooks();

  // Then run on every interval
  setInterval(processPendingWebhooks, POLLING_INTERVAL_MS);
}