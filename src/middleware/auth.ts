import { Request, Response, NextFunction } from "express";

// Simulated API keys for our mock gateway.
// NOTE: In production these would be stored in a database, hashed,
// and each key would be associated with a specific merchant account.
// SECURITY: Never hardcode real API keys like this in production —
// use environment variables or a secrets manager (e.g. AWS Secrets Manager).
const VALID_API_KEYS: Record<string, string> = {
  'sk_test_merchant_001': 'merchant_001', // key → merchantId
  'sk_test_merchant_002': 'merchant_002',
};

// Middleware that validates the API key on every incoming request.
// Mimics how real payment gateways (Stripe, Midtrans) handle authentication —
// via a Bearer token in the Authorization header.
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Extract the Authorization header from the request
  // Expected format: "Bearer sk_test_merchant_001"
  const authHeader = req.headers.authorization;

  // If no Authorization header at all, reject immediately
  if (!authHeader) {
    res.status(401).json({
      success: false,
      error: 'Missing Authorization header. Expected: Bearer <api_key>',
    });
    return; // NOTE: Always return after sending a response to stop execution
  }

  // Split "Bearer sk_test_merchant_001" into ["Bearer", "sk_test_merchant_001"]
  const parts = authHeader.split(' ');

  // Validate the format — must be exactly two parts, first must be "Bearer"
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({
      success: false,
      error: 'Invalid Authorization format. Expected: Bearer <api_key>',
    });
    return;
  }

  const apiKey = parts[1];

  // Check if the provided key exists in our valid keys store
  const merchantId = VALID_API_KEYS[apiKey];

  // If key not found, return 401 Unauthorized
  if (!merchantId) {
    res.status(401).json({
      success: false,
      error: 'Invalid API key',
    });
    return;
  }

  // SECURITY: Attach the merchantId to the request object so downstream
  // route handlers know which merchant is making this request —
  // without needing to look up the API key again.
  // NOTE: We extend Express's Request type to allow this custom property.
  (req as any).merchantId = merchantId;

  // All good — pass to the next middleware or route handler
  next();
}