import {
  CardToken,
  Payment,
  PaymentStatus,
  StatusEvent,
  WebhookEvent,
} from "../types";

// ─── In-Memory Collections ────────────────────────────────────────────────────

// NOTE: We use Map instead of plain objects because Map is optimized
// for frequent additions/lookups by key — exactly what a store does.
// Map also preserves insertion order and has cleaner API than objects.

// Stores all tokenized cards. Key = token ID (e.g. "tok_abc123")
const tokens = new Map<string, CardToken>();

// Stores all paymenrs. Key = payment ID (e.g. "pay_abc123")
const payments = new Map<string, Payment>();

// Stores all webhook events pending delivery. Key = webhook event ID
const webhooks = new Map<string, WebhookEvent>();

// ─── Token Store ──────────────────────────────────────────────────────────────

export const tokenStore = {
  // Saves a new card token into memory.
  // Called after a card is successfully tokenized.
  save(token: CardToken): CardToken {
    tokens.set(token.id, token);
    return token;
  },
  // Retrieves a token by its ID.
  // Returns undefined if not found - caller must handle this case.
  findById(id: string): CardToken | undefined {
    return tokens.get(id);
  },

  findAll(): CardToken[] {
    return Array.from(tokens.values());
  }
};

// ─── Payment Store ────────────────────────────────────────────────────────────

export const paymentStore = {
  // Saves a new payment record into memory.
  // Called when a payment is first created (status: INITIATED).
  save(payment: Payment): Payment {
    payments.set(payment.id, payment);
    return payment;
  },
  // Retrieves a payment by its ID.
  // Returns undefined if not found - caller must handle this case.
  findById(id: string): Payment | undefined {
    return payments.get(id);
  },
  // Updates a payment's status and appends to its history.
  // NOTE: Every status change goes through here - this is the single source of truth for state transitions. Never mutate payment directly.
  updateStatus(
    id: string,
    newStatus: PaymentStatus,
    reason?: string,
  ): Payment | undefined {
    // First, find existing payment
    const payment = payments.get(id);

    // If payment doesn't exist, return undefined - called handles the error
    if (!payment) return undefined;

    // Build the history event BEFORE changing the status
    // so we have an accurate record of when each transition happened
    const historyEvent: StatusEvent = {
      status: newStatus,
      timestamp: new Date(),
      // Only include reason if one was provided (e.g. "Insufficient funds")
      ...(reason && { reason }),
    };
    // Apply the update — spread existing payment, override changed fields
    // NOTE: We create a NEW object instead of mutating the existing one.
    // This is safer and makes it easier to track changes.
    const updatedPayment: Payment = {
        ...payment,
        status: newStatus,
        statusHistory: [...payment.statusHistory, historyEvent],
        updatedAt: new Date(),
    };
    // Persist the updated payment back into the Map
    payments.set(id, updatedPayment);
    return updatedPayment;
  },
  // Returns ALL payments as an array.
  // NOTE: In a real DB this would be a SELECT with filters/pagination.
  // For out mock, we just return everything.
  findAll(): Payment[] {
    return Array.from(payments.values());
  },
};

// ─── Webhook Store ────────────────────────────────────────────────────────────

export const webhookStore = {
  // Saves a new webhook event that needs to be delivered.
  // Called every time a payment changes state.
  save(event: WebhookEvent): WebhookEvent {
    webhooks.set(event.id, event);
    return event;
  },

  // Retrieves a webhook event by its ID.
  findById(id: string): WebhookEvent | undefined {
    return webhooks.get(id);
  },

  // Returns all webhook events that haven't been successfully delivered yet.
  // ASYNC: This is used by the webhook worker to know what still needs sending.
  // NOTE: "Pending" means either never attempted, or attempted but failed.
  findPending(): WebhookEvent[] {
    return Array.from(webhooks.values()).filter(
      // A webhook is "pending" if it has been attempted fewer than 5 times
      // NOTE: We cap at 5 retries — after that we give up to avoid
      // hammering a merchant's dead server forever (this is called a dead letter)
      (event) => event.attempts < 5
    );
  },

  // Updates the attempt count on a webhook after a delivery attempt.
  // Called by the webhook worker whether delivery succeeded or failed.
  incrementAttempts(id: string): void {
    const event = webhooks.get(id);

    // Guard: if event doesn't exist, do nothing
    if (!event) return;

    // Increment attempts and save back
    webhooks.set(id, { ...event, attempts: event.attempts + 1 });
  },

  // Removes a successfully delivered webhook from the pending queue.
  // NOTE: We delete it so the worker doesn't try to re-deliver it.
  markDelivered(id: string): void {
    webhooks.delete(id);
  },
};