import { CardToken, CreatePaymentRequest } from '../types';
import { detectCardNetwork } from './luhn';

// The result of a risk assessment.
// NOTE: We return both the score AND the reasons, so we can
// log exactly why a payment was flagged — useful for dispute resolution.
export interface RiskAssessment {
  score: number;        // 0-100. Higher = more risky
  reasons: string[];    // Human-readable list of why score was raised
  shouldDecline: boolean; // Convenience flag: true if score is too high to proceed
}

// Thresholds — these control how sensitive our fraud detection is.
// NOTE: In a real gateway these would be configurable per merchant,
// since a jewelry store has very different risk patterns than a coffee shop.
const DECLINE_THRESHOLD = 70;   // Score >= 70 → automatically decline
const HIGH_AMOUNT_THRESHOLD = 100000; // $1000.00 in cents → flag large amounts

// Analyzes a payment request and returns a risk score with reasons.
// SECURITY: This runs BEFORE we contact the bank — we want to catch
// obvious fraud ourselves rather than wasting a bank API call.
export function assessRisk(
  request: CreatePaymentRequest,
  token: CardToken,
): RiskAssessment {
  // Start with a clean slate
  let score = 0;
  const reasons: string[] = [];

  // ── Check 1: Large Amount ─────────────────────────────────────────────────
  // Unusually large transactions are statistically more likely to be fraud.
  // NOTE: In production, "large" is relative to each merchant's average
  // transaction size — we use a fixed threshold for simplicity.
  if (request.amount > HIGH_AMOUNT_THRESHOLD) {
    score += 30;
    reasons.push(`High transaction amount: ${request.amount} cents`);
  }

  // ── Check 2: Expired Card ─────────────────────────────────────────────────
  // An expired card should never make it this far, but we double-check.
  // SECURITY: Always validate expiry — some fraud involves testing expired cards.
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // getMonth() is 0-indexed

  const isExpired =
    token.expiryYear < currentYear ||
    (token.expiryYear === currentYear && token.expiryMonth < currentMonth);

  if (isExpired) {
    // Expired card is an automatic high-risk flag
    score += 50;
    reasons.push('Card is expired');
  }

  // ── Check 3: Unknown Card Network ─────────────────────────────────────────
  // If we can't identify the card network from the BIN, it's suspicious.
  // Legitimate cards are always issued by a known network.
  const network = detectCardNetwork(token.cardNumber);
  if (network === 'UNKNOWN') {
    score += 20;
    reasons.push('Unrecognized card network');
  }

  // ── Check 4: Round Number Amounts ─────────────────────────────────────────
  // Fraudsters often test stolen cards with round numbers ($100.00, $500.00)
  // to check if the card is active before making larger purchases.
  // NOTE: This is a weak signal alone, so only a small score bump.
  const amountInMajorUnit = request.amount / 100;
  if (amountInMajorUnit % 100 === 0 && request.amount > 0) {
    score += 10;
    reasons.push('Suspiciously round amount');
  }

  // ── Check 5: Missing or Suspicious Description ────────────────────────────
  // Legitimate merchants always provide a meaningful payment description.
  // Very short or generic descriptions are a mild red flag.
  if (!request.description || request.description.trim().length < 5) {
    score += 10;
    reasons.push('Missing or very short payment description');
  }

  // Cap score at 100 — no need to go higher
  const finalScore = Math.min(score, 100);

  return {
    score: finalScore,
    reasons,
    // Convenience flag so callers don't need to know the threshold
    shouldDecline: finalScore >= DECLINE_THRESHOLD,
  };
}