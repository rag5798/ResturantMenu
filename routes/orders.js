const router = require('express').Router();
const { getDB } = require('../models/database');
const { ObjectId } = require('mongodb');
const { stripeSecretKey } = require('../config/stripe');
const stripe = require('stripe')(stripeSecretKey, { timeout: 10000 });
const logger = require('../config/logger');
const { addAdminClient, broadcastOrderUpdate } = require('../config/sse');
const { sendOrderReady } = require('../config/email');

// Admin-only middleware
function requireAdmin(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized - admin login required' });
}

// Validate ObjectId format to prevent injection / crashes
function validateId(req, res, next) {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid order ID format' });
  }
  next();
}

// CSRF protection for state-changing requests (PATCH, DELETE)
function verifyCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

router.use(requireAdmin);

// SSE stream for real-time order updates (admin)
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  if (typeof res.flush === 'function') res.flush();

  addAdminClient(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
      if (typeof res.flush === 'function') res.flush();
    } catch { clearInterval(heartbeat); }
  }, 30000);
  res.on('close', () => clearInterval(heartbeat));
});

// GET /api/orders - Get orders with pagination (admin)
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const db = getDB();
    const col = db.collection('orders');

    const [orders, total] = await Promise.all([
      col.find().sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(),
    ]);

    res.json({
      orders,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/analytics - Best-selling items + revenue summary
router.get('/analytics', async (req, res, next) => {
  try {
    const db = getDB();
    const col = db.collection('orders');

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());

    const [topItems, summary] = await Promise.all([
      col.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.name',
            unitsSold: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          },
        },
        { $sort: { unitsSold: -1 } },
        { $limit: 10 },
      ]).toArray(),
      col.aggregate([
        {
          $facet: {
            allTime: [
              { $match: { paymentStatus: 'paid' } },
              { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
            ],
            today: [
              { $match: { paymentStatus: 'paid', createdAt: { $gte: startOfToday } } },
              { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
            ],
            thisWeek: [
              { $match: { paymentStatus: 'paid', createdAt: { $gte: startOfWeek } } },
              { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
            ],
          },
        },
      ]).toArray(),
    ]);

    const s = summary[0];
    res.json({
      topItems,
      allTime: s.allTime[0] || { revenue: 0, orders: 0 },
      today: s.today[0] || { revenue: 0, orders: 0 },
      thisWeek: s.thisWeek[0] || { revenue: 0, orders: 0 },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:id - Get single order
router.get('/:id', validateId, async (req, res, next) => {
  try {
    const db = getDB();
    const order = await db
      .collection('orders')
      .findOne({ _id: new ObjectId(req.params.id) });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/orders/:id/status - Update order status (admin)
router.patch('/:id/status', validateId, verifyCsrf, async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const db = getDB();
    const result = await db.collection('orders').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Order not found' });
    }
    broadcastOrderUpdate(req.params.id, { status, type: 'status_update' });
    if (status === 'ready') sendOrderReady(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/orders/:id - Delete an order (admin)
router.delete('/:id', validateId, verifyCsrf, async (req, res, next) => {
  try {
    const db = getDB();
    const result = await db
      .collection('orders')
      .deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ message: 'Order deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:id/refund - Issue a full refund via Stripe (admin)
router.post('/:id/refund', validateId, verifyCsrf, async (req, res, next) => {
  try {
    const db = getDB();
    const order = await db
      .collection('orders')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.paymentStatus === 'refunded') {
      return res.status(400).json({ error: 'Order is already refunded' });
    }

    if (!order.paymentIntentId) {
      return res.status(400).json({ error: 'No payment intent - cannot refund an unpaid order' });
    }

    const refund = await stripe.refunds.create({
      payment_intent: order.paymentIntentId,
    });

    await db.collection('orders').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          paymentStatus: 'refunded',
          status: 'cancelled',
          refundId: refund.id,
          refundedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    broadcastOrderUpdate(req.params.id, { status: 'cancelled', paymentStatus: 'refunded', type: 'refund' });
    logger.info('Refund issued - Order %s, Refund %s', req.params.id, refund.id);
    res.json({ message: 'Refund issued', refundId: refund.id });
  } catch (err) {
    if (err.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
