import { v4 as uuidv4 } from 'uuid';
import { Payment, CreatePaymentRequest, WebhookEvent, WebhookEventType } from '../types';
import { paymentStore, tokenStore, webhookStore } from '../store';
import { assessRisk } from '../utils';

// Custom error classes — each represents a distinct failure category.
// NOTE: Separate error classes let the route layer respond with the
// correct HTTP status code for each case.

// 404 — requested resource doesn't exist
export class PaymentNotFoundError extends Error {
  constructor(id: string) {
    super(`Payment not found: ${id}`);
    this.name = 'PaymentNotFoundError';
  }
}

// 400 — client did something wrong (bad state transition, invalid input)
export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

// ─── Webhook Queue Helper ─────────────────────────────────────────────────────

// Queues a webhook event for async delivery to the merchant.
// NOTE: We don't SEND the webhook here — we just save it to the store.
// The webhook worker (a separate background process) handles actual delivery.
// ASYNC: This is the handoff point between synchronous payment processing
// and asynchronous webhook delivery.
function queueWebhook(
  payment: Payment,
  type: WebhookEventType,
  webhookUrl: string
): void {
  const event: WebhookEvent = {
    id: `evt_${uuidv4().replace(/-/g, '').substring(0, 16)}`,
    type,
    payload: payment,      // Snapshot of payment at this moment in time
    webhookUrl,            // Where to deliver this event
    createdAt: new Date(),
    attempts: 0,           // Not yet attempted
  };

  // Save to webhook store — the worker will pick this up asynchronously
  webhookStore.save(event);
}

// ─── Create Payment ───────────────────────────────────────────────────────────

// Initiates a new payment — this is the main entry point for payment processing.
// ASYNC: Returns immediately with PENDING status. The actual bank simulation
// happens in the background via simulateBankResponse().
export async function createPayment(
  request: CreatePaymentRequest
): Promise<Payment> {

  // ── Step 1: Validate token exists ─────────────────────────────────────────
  // The merchant must tokenize the card first before creating a payment.
  // If the token doesn't exist, we reject immediately.
  const token = tokenStore.findById(request.tokenId);
  if (!token) {
    throw new PaymentError(`Token not found: ${request.tokenId}`);
  }

  // ── Step 2: Validate amount ───────────────────────────────────────────────
  // Amount must be a positive integer (in cents).
  // NOTE: We reject zero and negative amounts — these are likely bugs
  // in the merchant's integration, not legitimate payments.
  if (!Number.isInteger(request.amount) || request.amount <= 0) {
    throw new PaymentError('Amount must be a positive integer (in cents)');
  }

  // ── Step 3: Validate currency ─────────────────────────────────────────────
  // We only support a limited set of currencies in our mock.
  const supportedCurrencies = ['USD', 'IDR', 'EUR', 'SGD'];
  if (!supportedCurrencies.includes(request.currency.toUpperCase())) {
    throw new PaymentError(`Unsupported currency: ${request.currency}`);
  }

  // ── Step 4: Run fraud/risk assessment ─────────────────────────────────────
  // SECURITY: Assess risk BEFORE creating any payment record.
  // We want to reject obvious fraud before it even enters our system.
  const risk = assessRisk(request, token);

  // ── Step 5: Create payment record in INITIATED state ──────────────────────
  const payment: Payment = {
    id: `pay_${uuidv4().replace(/-/g, '').substring(0, 16)}`,
    tokenId: request.tokenId,
    amount: request.amount,
    currency: request.currency.toUpperCase(),
    // If risk score is too high, go straight to DECLINED
    // Otherwise start at INITIATED — normal flow begins
    status: risk.shouldDecline ? 'DECLINED' : 'INITIATED',
    merchantId: request.merchantId,
    description: request.description,
    webhookUrl: request.webhookUrl,
    riskScore: risk.score,
    // Initialize status history with the first event
    statusHistory: [{
      status: risk.shouldDecline ? 'DECLINED' : 'INITIATED',
      timestamp: new Date(),
      // If declined by risk, record the reasons so merchant knows why
      reason: risk.shouldDecline
        ? `Declined by risk engine: ${risk.reasons.join(', ')}`
        : 'Payment initiated',
    }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Persist the new payment to our store
  paymentStore.save(payment);

  // ── Step 6: Handle risk decline immediately ────────────────────────────────
  // If risk engine declined it, queue webhook and return — no bank call needed
  if (risk.shouldDecline) {
    queueWebhook(payment, 'payment.declined', request.webhookUrl);
    return payment;
  }

  // ── Step 7: Move to PENDING and simulate async bank processing ────────────
  // Update status to PENDING — we're now "waiting for the bank"
  const pendingPayment = paymentStore.updateStatus(
    payment.id,
    'PENDING',
    'Sent to bank for processing'
  )!;

  // Queue a webhook so merchant knows payment is now pending
  queueWebhook(pendingPayment, 'payment.initiated', request.webhookUrl);

  // ASYNC: Simulate bank response after a realistic delay.
  // NOTE: We use setTimeout to simulate the async nature of real bank calls.
  // We do NOT await this — we return to the caller immediately (202 behavior).
  setTimeout(() => {
    simulateBankResponse(payment.id, request.webhookUrl);
  }, getRandomDelay(1000, 3000)); // Random 1-3 second delay like a real bank

  // Return the PENDING payment immediately — merchant gets 202 response
  return pendingPayment;
}

// ─── Simulate Bank Response ───────────────────────────────────────────────────

// Simulates the bank's async response to an authorization request.
// In production, this would be a real API call to a payment processor.
// ASYNC: This runs in the background after createPayment() has already returned.
async function simulateBankResponse(
  paymentId: string,
  webhookUrl: string
): Promise<void> {
  const payment = paymentStore.findById(paymentId);

  // Guard: payment should always exist here, but we check defensively
  if (!payment) return;

  // Simulate bank's decision:
  // 85% approval rate — realistic for a normal merchant
  // NOTE: Real approval rates vary by merchant type, card type, and country.
  const isApproved = Math.random() < 0.85;

  if (isApproved) {
    // Bank authorized the payment — funds are reserved
    const authorizedPayment = paymentStore.updateStatus(
      paymentId,
      'AUTHORIZED',
      'Approved by issuing bank'
    )!;

    queueWebhook(authorizedPayment, 'payment.authorized', webhookUrl);

    // Auto-capture after a short delay — simulates merchant capturing payment.
    // NOTE: In a real gateway, the merchant explicitly calls /capture.
    // We auto-capture here to demonstrate the full flow automatically,
    // but our API also supports manual capture (see capturePayment below).
    setTimeout(() => {
      capturePayment(paymentId, webhookUrl);
    }, getRandomDelay(500, 1500));

  } else {
    // Bank declined — common reasons: insufficient funds, fraud flag, etc.
    const declinedPayment = paymentStore.updateStatus(
      paymentId,
      'DECLINED',
      'Declined by issuing bank: insufficient funds'
    )!;

    queueWebhook(declinedPayment, 'payment.declined', webhookUrl);
  }
}

// ─── Capture Payment ──────────────────────────────────────────────────────────

// Captures an authorized payment — actually moves the money.
// NOTE: Can be called manually by merchant via API, or automatically
// by simulateBankResponse() after authorization.
export async function capturePayment(
  paymentId: string,
  webhookUrl?: string
): Promise<Payment> {
  const payment = paymentStore.findById(paymentId);

  // 404 — payment doesn't exist
  if (!payment) throw new PaymentNotFoundError(paymentId);

  // Guard: can only capture an AUTHORIZED payment
  // NOTE: This enforces our state machine — PENDING → CAPTURED is not valid
  if (payment.status !== 'AUTHORIZED') {
    throw new PaymentError(
      `Cannot capture payment with status: ${payment.status}. Must be AUTHORIZED.`
    );
  }

  // Move to CAPTURED — money is now moving
  const capturedPayment = paymentStore.updateStatus(
    paymentId,
    'CAPTURED',
    'Payment captured successfully'
  )!;

  // Use provided webhookUrl or fall back to the one stored on the payment
  const url = webhookUrl ?? payment.webhookUrl;
  queueWebhook(capturedPayment, 'payment.captured', url);

  // Simulate settlement after a delay — in reality this takes 1-3 business days
  setTimeout(() => {
    settlePayment(paymentId, url);
  }, getRandomDelay(2000, 4000));

  return capturedPayment;
}

// ─── Void Payment ─────────────────────────────────────────────────────────────

// Voids an authorized payment — cancels before capture, no money moves.
// NOTE: Voiding is only possible on AUTHORIZED payments.
// Once CAPTURED, you'd need a refund instead (not implemented in this mock).
export async function voidPayment(paymentId: string): Promise<Payment> {
  const payment = paymentStore.findById(paymentId);

  if (!payment) throw new PaymentNotFoundError(paymentId);

  // Guard: can only void an AUTHORIZED payment
  if (payment.status !== 'AUTHORIZED') {
    throw new PaymentError(
      `Cannot void payment with status: ${payment.status}. Must be AUTHORIZED.`
    );
  }

  const voidedPayment = paymentStore.updateStatus(
    paymentId,
    'VOIDED',
    'Payment voided by merchant'
  )!;

  queueWebhook(voidedPayment, 'payment.voided', payment.webhookUrl);

  return voidedPayment;
}

// ─── Settle Payment ───────────────────────────────────────────────────────────

// Moves payment to SETTLED — funds have reached the merchant's account.
// NOTE: This is called automatically after capture, simulating the
// 1-3 business day settlement window in real banking.
// This is an internal function — merchants cannot call this directly.
async function settlePayment(
  paymentId: string,
  webhookUrl: string
): Promise<void> {
  const payment = paymentStore.findById(paymentId);

  if (!payment || payment.status !== 'CAPTURED') return;

  const settledPayment = paymentStore.updateStatus(
    paymentId,
    'SETTLED',
    'Funds settled to merchant account'
  )!;

  queueWebhook(settledPayment, 'payment.captured', webhookUrl);
}

// ─── Get Payment ──────────────────────────────────────────────────────────────

// Retrieves a single payment by ID.
// Used by merchants to poll payment status (though webhooks are preferred).
export function getPayment(paymentId: string): Payment {
  const payment = paymentStore.findById(paymentId);
  if (!payment) throw new PaymentNotFoundError(paymentId);
  return payment;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns a random integer between min and max milliseconds.
// Used to simulate realistic, variable bank response times.
// NOTE: Real banks don't respond in exactly the same time every time —
// randomizing makes our simulation more realistic.
function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}