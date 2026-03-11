import { Request, Response, NextFunction } from 'express';
import { z, ZodType } from 'zod';

// Zod schemas define the EXACT shape and rules of valid request bodies.
// NOTE: Think of these as a stricter version of TypeScript types —
// they validate the actual runtime data, not just the compile-time types.

// Schema for POST /api/tokens — tokenize a card
export const tokenizeCardSchema = z.object({
  // Card number: string, strip spaces/dashes, must pass basic length check
  cardNumber: z
    .string()
    .min(13, 'Card number too short')
    .max(19, 'Card number too long')
    .regex(/^[\d\s-]+$/, 'Card number must contain only digits, spaces, or dashes'),

  // Expiry month: integer between 1 and 12
  expiryMonth: z
    .number()
    .int('Expiry month must be an integer')
    .min(1, 'Expiry month must be between 1 and 12')
    .max(12, 'Expiry month must be between 1 and 12'),

  // Expiry year: integer, not in the past
  expiryYear: z
    .number()
    .int('Expiry year must be an integer')
    .min(new Date().getFullYear(), 'Card is expired'),

  // CVV: 3 or 4 digits only
  cvv: z
    .string()
    .regex(/^\d{3,4}$/, 'CVV must be 3 or 4 digits'),

  // Cardholder name: non-empty string
  cardholderName: z
    .string()
    .min(1, 'Cardholder name is required')
    .max(100, 'Cardholder name too long'),
});

// Schema for POST /api/payments — create a payment
export const createPaymentSchema = z.object({
  // Token ID must start with "tok_" — our self-describing ID format
  tokenId: z
    .string()
    .startsWith('tok_', 'Invalid token ID format'),

  // Amount in cents — must be a positive integer
  amount: z
    .number()
    .int('Amount must be an integer (in cents)')
    .positive('Amount must be greater than zero'),

  // Currency — 3 letter ISO code
  currency: z
    .string()
    .length(3, 'Currency must be a 3-letter ISO code (e.g. USD, IDR)')
    .toUpperCase(),

  // Merchant ID — non-empty string
  merchantId: z
    .string()
    .min(1, 'Merchant ID is required'),

  // Description — meaningful length
  description: z
    .string()
    .min(5, 'Description must be at least 5 characters')
    .max(255, 'Description too long'),

  // Webhook URL — must be a valid URL
  webhookUrl: z
    .string()
    .url('Webhook URL must be a valid URL'),
});

// Factory function that creates a validation middleware for any Zod schema.
// NOTE: This is a "middleware factory" — it returns a middleware function.
// This pattern lets us reuse the same validation logic for different schemas:
//   router.post('/tokens', validate(tokenizeCardSchema), handler)
//   router.post('/payments', validate(createPaymentSchema), handler)
export function validate(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Ask Zod to parse and validate req.body against the schema
    const result = schema.safeParse(req.body);

    // safeParse returns { success: true, data } or { success: false, error }
    // NOTE: We use safeParse instead of parse because parse throws an exception —
    // safeParse lets us handle errors gracefully without try/catch here.
    if (!result.success) {
      // Format Zod's error messages into a readable array
      // e.g. ["Card number too short", "CVV must be 3 or 4 digits"]
      const errors = result.error.issues.map(err => ({
        field: err.path.join('.'), // e.g. "expiryMonth"
        message: err.message,      // e.g. "Expiry month must be between 1 and 12"
      }));

      res.status(400).json({
        success: false,
        error: 'Validation failed',
        // NOTE: We return ALL validation errors at once, not just the first one.
        // This is much better UX — merchant fixes all issues in one go.
        details: errors,
      });
      return;
    }

    // Validation passed — replace req.body with the parsed/coerced data
    // NOTE: Zod may have transformed some values (e.g. currency.toUpperCase())
    // so we use result.data instead of the original req.body
    req.body = result.data;

    next();
  };
}