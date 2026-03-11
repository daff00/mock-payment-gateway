// ─── Payment States ───────────────────────────────────────────────────────────

// Represents every possible state a payment can be in.
// NOTE: This is a "string literal union" — TypeScript will only allow
// these exact strings, preventing typos like "authorised" vs "authorized".

export type PaymentStatus = 
    | 'INITIATED'   // Payment request received, not yet processed
    | 'PENDING'     // Sent to bank/processor, awaiting response
    | 'AUTHORIZED'  // Bank approved & reserved the funds
    | 'CAPTURED'    // Funds actually moved from customer to merchant
    | 'SETTLED'     // Funds reached merchant's account (final state)
    | 'DECLINED'    // Bank rejected the payment (final state)
    | 'VOIDED'      // Authorized but cancelled before capture (final state)
    | 'FAILED';     // Technical error during processing (final state)

// ─── Card Token ───────────────────────────────────────────────────────────────

// Represents a tokenized card stored in our vault.
// SECURITY: We NEVER store the raw card number anywhere outside this structure.
// The 'cardNumber' field here would in reality be encrypted at rest.
export interface CardToken {
    id: string;             // The token ID (e.g. "tok_a3f9b2c1") — safe to share with merchants
    last4: string;          // Last 4 digits of card — safe to display in UI ("ending in 4242")
    expiryMonth: number;    // Card expiry month (1-12)
    expiryYear: number;     // Card expiry year (e.g. 2027)
    cardHolderName: string; // Name on the card
    cardNumber: string;     // SECURITY: In production this would be encrypted, never plain text
    cvv: string;            // SECURITY: In reality, CVV must NEVER be stored after authorization
    createdAt: Date;        // When this token was created
}

// ─── Payment ──────────────────────────────────────────────────────────────────

// Represents a complete payment record — this is what gets stored and tracked.
export interface Payment {
  id: string;                   // Unique payment ID (e.g. "pay_x7k2m9p1")
  tokenId: string;              // Reference to the CardToken used — NOT the card number
  amount: number;               // Amount in smallest currency unit (cents). 
                                // NOTE: $10.00 is stored as 1000, never as 10.00
                                // This avoids floating point bugs (0.1 + 0.2 !== 0.3 in JS)
  currency: string;             // ISO 4217 currency code (e.g. "USD", "IDR")
  status: PaymentStatus;        // Current state in the payment state machine
  merchantId: string;           // Which merchant initiated this payment
  description: string;          // Payment description (e.g. "Order #1234")
  riskScore: number;            // Fraud risk score (0-100). Higher = more suspicious
  statusHistory: StatusEvent[]; // Full audit trail of every state transition
  createdAt: Date;
  updatedAt: Date;
  webhookUrl: string;
}

// Represents a single state transition in the payment's history.
// NOTE: This gives us a full audit trail — critical for dispute resolution.
export interface StatusEvent {
  status: PaymentStatus; // The status that was set
  timestamp: Date;       // When the transition happened
  reason?: string;       // Optional reason (e.g. "Insufficient funds", "Fraud detected")
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

// All possible webhook event types the gateway can fire.
// NOTE: Named as "resource.action" — this is industry standard (used by Stripe, etc.)
export type WebhookEventType =
  | 'payment.initiated'
  | 'payment.authorized'
  | 'payment.captured'
  | 'payment.declined'
  | 'payment.voided'
  | 'payment.failed';

// The actual webhook payload sent to the merchant's endpoint.
export interface WebhookEvent {
  id: string;               // Unique event ID — merchants use this to deduplicate
  type: WebhookEventType;   // What happened
  payload: Payment;         // The full payment object at the time of the event
  createdAt: Date;
  attempts: number;         // How many times we've tried to deliver this webhook
  webhookUrl: string;
                            // NOTE: Webhooks can fail (merchant server down), so we retry
}

// ─── API Request & Response Shapes ───────────────────────────────────────────

// What the merchant sends us to tokenize a card.
export interface TokenizeCardRequest {
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  cardholderName: string;
}

// What the merchant sends us to create a payment.
export interface CreatePaymentRequest {
  tokenId: string;      // Use the token, never the raw card
  amount: number;       // In cents/smallest unit
  currency: string;
  merchantId: string;
  description: string;
  webhookUrl: string;   // Where we should POST webhook events for this payment
}

// Standard API response wrapper.
// NOTE: Every response from our API follows this shape — consistent structure
// makes it easier for merchants to handle responses predictably.
export interface ApiResponse<T> {
  success: boolean;
  data?: T;       // Present when success: true
  error?: string; // Present when success: false
}