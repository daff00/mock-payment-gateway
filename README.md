<div align="center">

# 🏦 Mock Payment Gateway

A simulated payment gateway built for learning purposes — understand how real payment gateways work without needing a real business account.

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white)

</div>

---

## 📖 What Does This Do?

This project simulates how a real payment gateway (like Stripe or Midtrans) works:

- 💳 **Tokenize** a card — convert raw card details into a safe token
- 💸 **Process payments** — simulate the full payment lifecycle
- 🔔 **Webhooks** — get notified when a payment status changes
- 🚨 **Fraud detection** — automatically flag suspicious payments

---

## 🗂️ Project Structure

```
src/
├── index.ts          → Entry point, starts the server
├── routes/           → HTTP endpoints (what URLs are available)
├── services/         → Business logic (how payments work)
├── middleware/       → Auth, validation, error handling
├── workers/          → Background webhook delivery
├── store/            → In-memory database
├── types/            → TypeScript type definitions
└── utils/            → Card validation & fraud scoring
```

---

## ⚙️ Requirements

Make sure you have these installed before starting:

- [Node.js](https://nodejs.org/) v18 or higher
- [npm](https://www.npmjs.com/) (comes with Node.js)

To check if you have them:
```bash
node --version   # should print v18.x.x or higher
npm --version    # should print 8.x.x or higher
```

---

## 🚀 Getting Started

Follow these steps in order:

**1. Clone the project**
```bash
git clone <your-repo-url>
cd mock-payment-gateway
```

**2. Install dependencies**
```bash
npm install
```

**3. Start the server**
```bash
npm run dev
```

You should see:
```
[Server] Mock Payment Gateway running on port 3000
[Server] Health check: http://localhost:3000/health
[Webhook] Worker started. Polling every 5s
```

The server is now running at `http://localhost:3000` ✅

---

## 🔑 Authentication

Every request (except health check) requires an API key in the header:

```
Authorization: Bearer sk_test_merchant_001
```

**Available test API keys:**

| API Key | Merchant ID |
|---|---|
| `sk_test_merchant_001` | merchant_001 |
| `sk_test_merchant_002` | merchant_002 |

---

## 📡 API Endpoints

### Health Check
```
GET /health
```
Verify the server is running. No API key needed.

---

### Tokenize a Card
```
POST /api/tokens
```
Convert raw card details into a safe token. Always do this **before** creating a payment.

**Request body:**
```json
{
  "cardNumber": "4111111111111111",
  "expiryMonth": 12,
  "expiryYear": 2027,
  "cvv": "123",
  "cardholderName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "tok_xxxxxxxxxxxx",
    "last4": "1111",
    "expiryMonth": 12,
    "expiryYear": 2027,
    "cardholderName": "John Doe",
    "createdAt": "..."
  }
}
```
> 💾 Copy the `id` — you'll need it to create a payment.

---

### Create a Payment
```
POST /api/payments
```
Initiate a payment using a token. Returns immediately with `PENDING` status — the actual processing happens in the background.

**Request body:**
```json
{
  "tokenId": "tok_xxxxxxxxxxxx",
  "amount": 5000,
  "currency": "USD",
  "merchantId": "merchant_001",
  "description": "Order #1234 - Running Shoes",
  "webhookUrl": "https://webhook.site/your-unique-url"
}
```

> 💡 `amount` is in **cents** — `5000` means **$50.00**
>
> 💡 Get a free webhook URL at [webhook.site](https://webhook.site) to see live events

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "pay_xxxxxxxxxxxx",
    "status": "PENDING",
    "amount": 5000,
    "currency": "USD",
    ...
  }
}
```
> 💾 Copy the `id` — you'll need it to check payment status.

---

### Get Payment Status
```
GET /api/payments/:id
```
Check the current status of a payment.

**Example:**
```
GET /api/payments/pay_xxxxxxxxxxxx
```

Watch the status automatically progress through:
```
PENDING → AUTHORIZED → CAPTURED → SETTLED
```

---

### Capture a Payment
```
POST /api/payments/:id/capture
```
Manually capture an authorized payment (moves the money).

**Example:**
```
POST /api/payments/pay_xxxxxxxxxxxx/capture
```

> ⚠️ Payment must be in `AUTHORIZED` state to capture.

---

### Void a Payment
```
POST /api/payments/:id/void
```
Cancel an authorized payment before it is captured. No money moves.

**Example:**
```
POST /api/payments/pay_xxxxxxxxxxxx/void
```

> ⚠️ Payment must be in `AUTHORIZED` state to void.

---

## 💳 Test Card Numbers

These card numbers are safe to use for testing — they pass validation but are not real cards:

| Card Number | Network | Result |
|---|---|---|
| `4111111111111111` | Visa | ✅ Valid |
| `5500005555555559` | Mastercard | ✅ Valid |
| `4111111111111112` | Visa | ❌ Fails Luhn check |

---

## 💰 Payment States

A payment goes through these states automatically:

```
INITIATED → PENDING → AUTHORIZED → CAPTURED → SETTLED
                           ↓
                         VOIDED
               ↓
            DECLINED (by bank or fraud engine)
               ↓
            FAILED (technical error)
```

| State | Meaning |
|---|---|
| `INITIATED` | Payment request received |
| `PENDING` | Waiting for bank response |
| `AUTHORIZED` | Bank approved, funds reserved |
| `CAPTURED` | Money actually moved |
| `SETTLED` | Funds reached merchant |
| `DECLINED` | Bank or fraud engine rejected |
| `VOIDED` | Cancelled before capture |
| `FAILED` | Technical error |

---

## 🚨 Fraud Detection

The gateway automatically scores each payment for fraud risk (0–100). Payments scoring **70 or above** are automatically declined.

**What raises the risk score:**

| Rule | Score Added |
|---|---|
| Amount over $1,000 | +30 |
| Expired card | +50 |
| Unknown card network | +20 |
| Suspiciously round amount | +10 |
| Missing or short description | +10 |

**To trigger an automatic decline**, try a payment with:
```json
{
  "amount": 200000,
  "description": "hi",
  ...
}
```
This scores: `30 (high amount) + 10 (round) + 10 (short description) = 50` — add an expired card token to push it over 70.

---

## 🔔 Webhooks

When a payment status changes, the gateway automatically sends a `POST` request to your `webhookUrl` with this payload:

```json
{
  "id": "evt_xxxxxxxxxxxx",
  "type": "payment.captured",
  "payload": { ...payment object... },
  "createdAt": "..."
}
```

**Event types:**

| Event | When it fires |
|---|---|
| `payment.initiated` | Payment is now pending |
| `payment.authorized` | Bank approved the payment |
| `payment.captured` | Funds moved successfully |
| `payment.declined` | Payment was rejected |
| `payment.voided` | Payment was cancelled |

> 💡 Use [webhook.site](https://webhook.site) to inspect webhook events during testing — it gives you a free URL that displays all incoming requests in real time.

---

## 🛠️ Available Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start server with hot reload (use this during development) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run the compiled version |

---

## 📚 Concepts You'll Learn From This Project

- **Card Tokenization** — why raw card numbers are never stored
- **Payment State Machine** — why payments have multiple states
- **Webhooks** — event-driven async notifications
- **Fraud Detection** — risk scoring before processing
- **Luhn Algorithm** — mathematical card number validation
- **Layered Architecture** — separating routes, services, and data
- **API Key Authentication** — how payment gateways authenticate merchants