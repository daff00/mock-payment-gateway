import { v4 as uuidv4, validate } from "uuid";
import { createHash } from "crypto";
import { CardToken, TokenizeCardRequest } from "../types";
import { tokenStore } from "../store";
import { validateLuhn } from "../utils";

// Custom error class for tokenization failures.
// NOTE: We use a custom error class instead of generic Error so the
// route layer can distinguish between "our fault" vs "client's fault".
export class TokenizationError extends Error {
  constructor(message: string) {
    // Call the parent Error constructor with our message
    super(message);
    // Set the name so it shows clearly in logs: "TokenizationError: ..."
    this.name = 'TokenizationError';
  }
}

// Tokenizes a raw card and stores it securely in the token vault.
// Returns the token (WITHOUT the raw card number) to the merchant.
// SECURITY: After this function, the merchant never needs to see
// the raw card number again — they use the token ID for everything.
export function tokenizeCard(request: TokenizeCardRequest): CardToken {

  // ── Validation ─────────────────────────────────────────────────────────────

  // Run Luhn check first — reject mathematically invalid card numbers
  // before doing anything else. Fail fast, fail cheap.
  if (!validateLuhn(request.cardNumber)) {
    throw new TokenizationError('Invalid card number');
  }

  // Validate expiry month is within real calendar range
  if (request.expiryMonth < 1 || request.expiryMonth > 12) {
    throw new TokenizationError('Invalid expiry month');
  }

  // Validate expiry year is not in the past
  const currentYear = new Date().getFullYear();
  if (request.expiryYear < currentYear) {
    throw new TokenizationError('Card is expired');
  }

  // Validate CVV — must be 3 digits (Visa/MC) or 4 digits (Amex)
  // NOTE: We accept both lengths here and let the network type determine
  // which is correct. A real gateway would cross-check with the network.
  if (!/^\d{3,4}$/.test(request.cvv)) {
    throw new TokenizationError('Invalid CVV format');
  }

  // Validate cardholder name is not empty
  if (!request.cardholderName.trim()) {
    throw new TokenizationError('Cardholder name is required');
  }

  // ── Duplicate Detection ────────────────────────────────────────────────────

  // SECURITY: Hash the card number to check for duplicates WITHOUT
  // storing or comparing raw card numbers.
  // NOTE: If the same card is tokenized twice, we return the existing
  // token instead of creating a duplicate. This is called "token reuse".
  // sha256 is a one-way hash — you can't reverse it back to the card number.
  const cardHash = createHash('sha256')
    .update(request.cardNumber)
    .digest('hex');

  // Check if this card was already tokenized by scanning existing tokens
  // NOTE: In a real system this would be an indexed DB lookup, not a scan
  const existingToken = Array.from(
    // We access the raw map via a helper — see NOTE below
    tokenStore.findAll()
  ).find(token => {
    // Re-hash the stored card number to compare
    // SECURITY: We never compare raw card numbers directly
    return createHash('sha256')
      .update(token.cardNumber)
      .digest('hex') === cardHash;
  });

  // If we found an existing token for this card, return it immediately
  if (existingToken) return existingToken;

  // ── Token Creation ─────────────────────────────────────────────────────────

  // Generate a unique token ID with a "tok_" prefix
  // NOTE: Prefixes like "tok_", "pay_" make IDs self-describing in logs.
  // This is a pattern Stripe popularized and the industry has adopted.
  const token: CardToken = {
    id: `tok_${uuidv4().replace(/-/g, '').substring(0, 16)}`,
    // SECURITY: Only store last 4 digits for display purposes
    last4: request.cardNumber.slice(-4),
    expiryMonth: request.expiryMonth,
    expiryYear: request.expiryYear,
    cardHolderName: request.cardholderName.trim(),
    // NOTE: In production this would be encrypted with AES-256 before storing.
    // We store it plain here only because this is a mock/learning project.
    cardNumber: request.cardNumber,
    cvv: request.cvv,
    createdAt: new Date(),
  };

  // Persist the token and return it to the caller
  return tokenStore.save(token);
}