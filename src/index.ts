import express from 'express';
import { errorHandler } from './middleware';
import router from './routes';
import { startWebhookWorker } from './workers/webhookWorker';

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Global Middleware ────────────────────────────────────────────────────────

// Parse incoming JSON request bodies.
// NOTE: Without this, req.body would be undefined for POST requests.
// This must be registered BEFORE our routes.
app.use(express.json());

// Parse URL-encoded bodies (e.g. from HTML forms).
// NOTE: 'extended: true' allows nested objects in form data.
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────────────────────────

// Simple endpoint to verify the server is running.
// NOTE: No auth required — this is intentionally public.
// Load balancers and monitoring tools use this to check server health.
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime(), // How long the server has been running (seconds)
    },
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// Mount all payment gateway routes under /api prefix.
// NOTE: All routes defined in routes/index.ts will be accessible
// at /api/tokens, /api/payments, etc.
app.use('/api', router);

// ─── Error Handler ────────────────────────────────────────────────────────────

// IMPORTANT: Error handler must be registered LAST — after all routes.
// Express identifies error middleware by its 4 parameters (err, req, res, next).
// If registered before routes, it won't catch errors from those routes.
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[Server] Mock Payment Gateway running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);

  // Start the webhook delivery worker alongside the HTTP server.
  // NOTE: Both run in the same Node.js process — the worker uses setInterval
  // which doesn't block the event loop, so HTTP requests still get handled normally.
  startWebhookWorker();
});

export default app;