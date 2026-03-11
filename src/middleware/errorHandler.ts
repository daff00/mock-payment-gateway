import { Request, Response, NextFunction } from 'express';
import { PaymentNotFoundError, PaymentError } from '../services';
import { TokenizationError } from '../services';

// Global error handling middleware.
// NOTE: Express identifies error middleware by its 4 parameters (err, req, res, next).
// It MUST have exactly 4 parameters — Express won't treat it as error middleware otherwise.
// IMPORTANT: This must be registered LAST in Express — after all routes.
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction // eslint-disable-line @typescript-eslint/no-unused-vars
): void {
  // Log the full error server-side for debugging
  // NOTE: In production you'd send this to a logging service (e.g. Datadog, Sentry)
  console.error(`[ERROR] ${err.name}: ${err.message}`);

  // ── Map known error types to appropriate HTTP status codes ─────────────────

  // 404 — payment doesn't exist
  if (err instanceof PaymentNotFoundError) {
    res.status(404).json({
      success: false,
      error: err.message,
    });
    return;
  }

  // 400 — bad request (invalid state transition, bad input)
  if (err instanceof PaymentError || err instanceof TokenizationError) {
    res.status(400).json({
      success: false,
      error: err.message,
    });
    return;
  }

  // 500 — unexpected error (bug in our code, unhandled case)
  // NOTE: We deliberately hide the details from the client for security —
  // internal error messages can leak sensitive implementation details.
  res.status(500).json({
    success: false,
    error: 'An unexpected error occurred. Please try again later.',
  });
}