const router = require('express').Router();
const { stripeSecretKey } = require('../config/stripe');
const stripe = require('stripe')(stripeSecretKey, {
  timeout: 10000, // 10 second timeout on all Stripe API calls
});
const { getDB } = require('../models/database');
const { ObjectId } = require('mongodb');
const menuDataFallback = require('../models/menu');
const logger = require('../config/logger');
const { sendOrderConfirmation } = require('../config/email');
const { notifyNewOrder } = require('../config/discord-notify');
const { broadcastOrderUpdate } = require('../config/sse');

// Helper: look up a menu item by id from DB (falls back to hardcoded data)
async function findMenuItem(itemId) {
  try {
    const db = getDB();
    const category = await db.collection('menu_categories').findOne({
      'items.id': itemId,
    });
    if (category) {
      return category.items.find((i) => i.id === itemId);
    }
  } catch {
    // Fall back to hardcoded data if DB query fails
  }
  for (const category of menuDataFallback.categories) {
    const item = category.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return null;
}

// POST /api/payment/create-checkout-session
// Creates a Stripe Checkout hosted session and saves the order
router.post('/create-checkout-session', async (req, res, next) => {
  try {
    const { items, customerName, customerEmail } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // Validate and sanitize customer input
    const safeName = typeof customerName === 'string'
      ? customerName.replace(/<[^>]*>/g, '').trim().slice(0, 100)
      : '';
    const safeEmail = typeof customerEmail === 'string'
      ? customerEmail.trim().slice(0, 254)
      : '';
    if (!safeEmail) {
      return res.status(400).json({ error: 'Email is required for order confirmation' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate items and look up TRUSTED prices from menu data
    const verifiedItems = [];
    for (const cartItem of items) {
      const menuItem = await findMenuItem(cartItem.id);
      if (!menuItem) {
        return res.status(400).json({ error: `Unknown menu item: ${cartItem.id}` });
      }
      const qty = parseInt(cartItem.quantity, 10);
      if (!qty || qty < 1 || qty > 50) {
        return res.status(400).json({ error: `Invalid quantity for ${menuItem.name}` });
      }
      verifiedItems.push({
        id: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,   // from server, NOT from client
        quantity: qty,
      });
    }

    // Build Stripe line items from verified data
    const lineItems = verifiedItems.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.name },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    const total = verifiedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // Save order to database first
    const db = getDB();
    const order = {
      customerName: safeName || 'Guest',
      customerEmail: safeEmail,
      items: verifiedItems,
      total: Math.round(total * 100) / 100,
      status: 'pending',
      paymentStatus: 'awaiting_payment',
      createdAt: new Date(),
    };
    const result = await db.collection('orders').insertOne(order);

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: safeEmail || undefined,
      metadata: {
        orderId: result.insertedId.toString(),
        customerName: safeName || 'Guest',
      },
      success_url: `${req.protocol}://${req.get('host')}/checkout?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/checkout?cancelled=true`,
    });

    // Store session ID on the order
    await db.collection('orders').updateOne(
      { _id: result.insertedId },
      { $set: { stripeSessionId: session.id } }
    );

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// GET /api/payment/verify-session/:id - Verify checkout session is real and paid
router.get('/verify-session/:id', async (req, res, next) => {
  try {
    const sessionId = req.params.id;

    // Basic format check — Stripe session IDs start with cs_
    if (!sessionId || !sessionId.startsWith('cs_')) {
      return res.status(400).json({ verified: false, error: 'Invalid session ID' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Cross-check: order exists in our DB with this session
    const db = getDB();
    const order = await db.collection('orders').findOne({ stripeSessionId: sessionId });

    res.json({
      verified: session.payment_status === 'paid' && !!order,
      status: session.payment_status,
      customerName: order?.customerName || null,
      customerEmail: order?.customerEmail || null,
      orderId: order?._id?.toString() || null,
      orderTotal: order?.total || null,
      items: order?.items?.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })) || [],
    });
  } catch (err) {
    // Stripe throws if session ID doesn't exist — that means it's fake
    if (err.type === 'StripeInvalidRequestError') {
      return res.json({ verified: false, error: 'Session not found' });
    }
    next(err);
  }
});

// ============================================================
// Stripe Webhook — real-time payment event handler
// ============================================================
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

router.post('/webhook', async (req, res) => {
  let event;

  // Always verify webhook signature — reject if secret not configured
  if (!WEBHOOK_SECRET) {
    logger.error('STRIPE_WEBHOOK_SECRET not set - rejecting webhook');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const sig = req.headers['stripe-signature'];
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    logger.error('Webhook signature verification failed: %s', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const db = getDB();

  // Idempotency: skip events we've already processed
  const existing = await db.collection('processed_events').findOne({ _id: event.id });
  if (existing) {
    logger.info('Skipping duplicate event: %s', event.id);
    return res.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      // ---- Checkout session completed ----
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orderId = session.metadata?.orderId;
        if (orderId && ObjectId.isValid(orderId)) {
          await db.collection('orders').updateOne(
            { _id: new ObjectId(orderId) },
            {
              $set: {
                status: 'preparing',
                paymentStatus: 'paid',
                paymentIntentId: session.payment_intent,
                stripeSessionId: session.id,
                paidAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );
          logger.info('Order paid via Checkout - Order %s', orderId);

          // Send confirmation email (non-blocking — never fails the webhook)
          const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
          if (order) {
            sendOrderConfirmation(order);
            notifyNewOrder(order);
            broadcastOrderUpdate(orderId, { status: 'preparing', paymentStatus: 'paid', type: 'new_order' });
          }
        }
        break;
      }

      // ---- Payment succeeded (direct payment intent) ----
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        await db.collection('orders').updateOne(
          { paymentIntentId: pi.id },
          {
            $set: {
              status: 'preparing',
              paymentStatus: 'paid',
              paidAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );
        logger.info('Order paid - PaymentIntent %s', pi.id);
        break;
      }

      // ---- Payment failed ----
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const failMsg =
          pi.last_payment_error?.message || 'Unknown payment error';
        await db.collection('orders').updateOne(
          { paymentIntentId: pi.id },
          {
            $set: {
              paymentStatus: 'failed',
              paymentError: failMsg,
              updatedAt: new Date(),
            },
          }
        );
        logger.warn('Payment failed - PaymentIntent %s: %s', pi.id, failMsg);
        break;
      }

      // ---- Payment cancelled ----
      case 'payment_intent.canceled': {
        const pi = event.data.object;
        await db.collection('orders').updateOne(
          { paymentIntentId: pi.id },
          {
            $set: {
              status: 'cancelled',
              paymentStatus: 'cancelled',
              updatedAt: new Date(),
            },
          }
        );
        logger.info('Payment cancelled - PaymentIntent %s', pi.id);
        break;
      }

      // ---- Refund issued ----
      case 'charge.refunded': {
        const charge = event.data.object;
        const piId = charge.payment_intent;
        await db.collection('orders').updateOne(
          { paymentIntentId: piId },
          {
            $set: {
              paymentStatus: 'refunded',
              refundedAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );
        logger.info('Refund processed - PaymentIntent %s', piId);
        break;
      }

      // ---- Dispute / chargeback ----
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const piId = dispute.payment_intent;
        await db.collection('orders').updateOne(
          { paymentIntentId: piId },
          {
            $set: {
              paymentStatus: 'disputed',
              disputeReason: dispute.reason,
              updatedAt: new Date(),
            },
          }
        );
        logger.warn('Dispute opened - PaymentIntent %s', piId);
        break;
      }

      default:
        logger.info('Unhandled webhook event: %s', event.type);
    }
    // Mark event as processed (with TTL — auto-cleanup after 7 days)
    await db.collection('processed_events').insertOne({
      _id: event.id,
      type: event.type,
      processedAt: new Date(),
    });
  } catch (err) {
    logger.error(err, 'Webhook handler error');
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  // Always return 200 so Stripe doesn't retry
  res.json({ received: true });
});

module.exports = router;
