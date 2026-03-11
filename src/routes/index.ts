import { Router, Request, Response, NextFunction } from 'express';
import {
  authMiddleware,
  validate,
  tokenizeCardSchema,
  createPaymentSchema,
} from '../middleware';
import {
  tokenizeCard,
  createPayment,
  capturePayment,
  voidPayment,
  getPayment,
} from '../services';

// Create a new Express Router instance.
// NOTE: Router is like a mini Express app — it handles a subset of routes
// and gets mounted onto the main app in index.ts.
// This keeps route definitions organized and modular.
const router = Router();

// ─── Apply Auth Middleware Globally ───────────────────────────────────────────

// Every route in this router requires a valid API key.
// NOTE: By calling router.use() here, authMiddleware runs automatically
// before ANY route handler below — we don't need to add it per-route.
router.use(authMiddleware);

// ─── POST /api/tokens ─────────────────────────────────────────────────────────

// Tokenizes a raw card and returns a safe token ID.
// This is always the FIRST call a merchant makes before creating a payment.
router.post(
  '/tokens',
  // validate() runs BEFORE the handler — rejects invalid bodies early
  validate(tokenizeCardSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // req.body is already validated and typed by Zod at this point
      const token = tokenizeCard(req.body);

      // 201 Created — a new resource (token) was created
      res.status(201).json({
        success: true,
        // SECURITY: We return the token but strip the raw card number
        // and CVV — merchant only needs the token ID and last4 for display
        data: {
          id: token.id,
          last4: token.last4,
          expiryMonth: token.expiryMonth,
          expiryYear: token.expiryYear,
          cardHolderName: token.cardHolderName,
          createdAt: token.createdAt,
        },
      });
    } catch (err) {
      // Pass any errors to the global error handler middleware
      // NOTE: Always use next(err) in async routes — throwing directly
      // won't reach the error handler in older Express versions
      next(err);
    }
  }
);

// ─── POST /api/payments ───────────────────────────────────────────────────────

// Initiates a new payment using a token.
// Returns 202 Accepted immediately — actual processing is async.
router.post(
  '/payments',
  validate(createPaymentSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payment = await createPayment(req.body);

      // 202 Accepted — request received, processing happening asynchronously
      // NOTE: We use 202 specifically (not 200 or 201) because the payment
      // isn't complete yet — it's PENDING. The merchant will get the final
      // status via webhook.
      res.status(202).json({
        success: true,
        data: payment,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/payments/:id ────────────────────────────────────────────────────

// Retrieves a payment by ID — for merchants who want to poll status.
// NOTE: Webhooks are preferred over polling, but this endpoint exists
// as a fallback (e.g. merchant missed a webhook, wants to verify state).
router.get(
  '/payments/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // req.params.id is the :id part of the URL
      // e.g. GET /api/payments/pay_abc123 → req.params.id = "pay_abc123"
      const payment = getPayment(req.params['id'] as string);

      res.status(200).json({
        success: true,
        data: payment,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/payments/:id/capture ──────────────────────────────────────────

// Manually captures an authorized payment.
// NOTE: This is for merchants who want explicit control over when funds
// are captured (e.g. capturing only after confirming stock availability).
router.post(
  '/payments/:id/capture',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payment = await capturePayment(req.params['id'] as string);

      res.status(200).json({
        success: true,
        data: payment,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/payments/:id/void ─────────────────────────────────────────────

// Voids an authorized payment — cancels before capture.
// NOTE: Use this when you need to cancel AFTER authorization but BEFORE capture.
// Example: customer cancels order, item went out of stock.
router.post(
  '/payments/:id/void',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payment = await voidPayment(req.params['id'] as string);

      res.status(200).json({
        success: true,
        data: payment,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;