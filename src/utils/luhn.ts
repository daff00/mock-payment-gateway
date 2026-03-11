// Validates a card number using the Luhn algorithm.
// SECURITY: This is the FIRST line of defense against invalid card numbers.
// Always run this before any other card processing logic.
// NOTE: This only proves a number is *mathematically valid*, not that the
// card actually exists or has funds — that's the bank's job.
export function validateLuhn(cardNumber: string): boolean {
  // Remove any spaces or dashes the user might have typed
  // e.g. "4111 1111 1111 1111" → "4111111111111111"
  const sanitized = cardNumber.replace(/[\s-]/g, '');

  // Card numbers must be numeric only — reject anything else
  if (!/^\d+$/.test(sanitized)) return false;

  // Card numbers are between 13-19 digits (industry standard range)
  if (sanitized.length < 13 || sanitized.length > 19) return false;

  let sum = 0;

  // We process digits from right to left
  // 'isSecond' tracks whether current digit should be doubled
  let isSecond = false;

  for (let i = sanitized.length - 1; i >= 0; i--) {
    // Convert the character to an actual number
    let digit = parseInt(sanitized[i], 10);

    // Every second digit from the right gets doubled
    if (isSecond) {
      digit *= 2;

      // If doubling gives us > 9, subtract 9
      // NOTE: This is equivalent to summing the two digits
      // e.g. 14 → 1 + 4 = 5, which is the same as 14 - 9 = 5
      if (digit > 9) digit -= 9;
    }

    sum += digit;

    // Flip the flag for the next iteration
    isSecond = !isSecond;
  }

  // Valid card numbers always produce a sum divisible by 10
  return sum % 10 === 0;
}

// Detects the card network from the card number prefix.
// NOTE: Each card network has a reserved range of prefixes (BINs).
// This is how checkout pages show the Visa/Mastercard logo as you type.
export function detectCardNetwork(cardNumber: string): string {
  const sanitized = cardNumber.replace(/[\s-]/g, '');

  // Visa: always starts with 4
  if (/^4/.test(sanitized)) return 'VISA';

  // Mastercard: starts with 51-55 or 2221-2720
  if (/^5[1-5]/.test(sanitized) || /^2[2-7]/.test(sanitized)) return 'MASTERCARD';

  // Amex: starts with 34 or 37, and is 15 digits
  if (/^3[47]/.test(sanitized)) return 'AMEX';

  // NOTE: There are many more networks (JCB, UnionPay, Discover etc.)
  // but these three cover the vast majority of real-world cards
  return 'UNKNOWN';
}