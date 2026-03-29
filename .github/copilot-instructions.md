# Copilot Instructions - Restaurant Menu

## Project Overview
Node.js/Express restaurant website with **menu catalog** and **Stripe payment integration**. Core functionality: browse restaurant menu items, add to cart, and process payments via Stripe.

## Architecture & Tech Stack
- **Runtime**: Node.js + Express.js framework
- **Payment Processor**: Stripe (PCI-compliant card handling)
- **Server Port**: 3000 (configurable via `PORT` env var)
- **Main Entry**: [server.js](../../server.js)

## Project Structure
```
/routes           - API endpoint handlers
  ├── menu.js     - Menu retrieval endpoints
  └── payment.js  - Stripe payment intent endpoints
/models           - Data structures
  └── menu.js     - Menu categories and items
/config           - Configuration managers
  └── stripe.js   - Stripe setup and keys
.env.example      - Template for environment variables
```

## Getting Started

### Setup
1. **Install dependencies**: `npm install`
2. **Configure Stripe**: Copy `.env.example` to `.env` and add your Stripe Secret Key:
   ```
   STRIPE_SECRET_KEY=sk_test_your_key_here
   ```
   Get your key from [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
3. **Start server**: `npm start` (runs on port 3000)

### API Endpoints

#### Menu API (`/api/menu`)
- `GET /api/menu` - Get all menu categories and items
- `GET /api/menu/category/:categoryId` - Get items in specific category
- `GET /api/menu/item/:itemId` - Get single item details

#### Payment API (`/api/payment`)
- `POST /api/payment/create-payment-intent` - Create Stripe payment intent
  - Body: `{ amount, currency, description }`
  - Returns: `{ clientSecret, paymentIntentId }`
- `GET /api/payment/payment-intent/:id` - Check payment status

## Key Patterns

### Menu Data Structure
Menu items organized by category (see [models/menu.js](../../models/menu.js)):
```javascript
{ id, name, description, price, image, category }
```

### Stripe Integration
- Uses `stripe` npm package for backend processing
- Payment intents created server-side, client secret sent to frontend
- Amount stored in cents (multiply user input by 100)
- Error handling: Catch and return error messages to client

### Environment Configuration
- Loads from `.env` via `dotenv` package
- Required: `STRIPE_SECRET_KEY`
- Optional: `PORT` (defaults to 3000), `NODE_ENV`

## Important Implementation Details
1. **Middleware**: Body-parser enabled for JSON and URL-encoded payloads
2. **Error Handling**: Payment errors return 500 with error message
3. **Health Check**: `GET /api/health` to verify server status
4. **Amount Conversion**: Frontend sends dollars, backend converts to cents for Stripe

## Development Notes
- No database yet - menu data hardcoded in [models/menu.js](../../models/menu.js)
- No authentication/authorization implemented
- No frontend yet - API-only at this stage
- Menu categories must have unique IDs for filtering

