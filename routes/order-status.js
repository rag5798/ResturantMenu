const router = require('express').Router();
const { getDB } = require('../models/database');
const { ObjectId } = require('mongodb');
const { addOrderClient } = require('../config/sse');

// GET /api/order-status?email=foo@bar.com&orderId=abc123
// Public endpoint — returns limited order info for the customer
router.get('/', async (req, res, next) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    const orderId = (req.query.orderId || '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const db = getDB();
    const query = { customerEmail: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } };

    // If orderId provided, narrow the search
    if (orderId) {
      // Support both full ID and last-6-char shorthand
      if (ObjectId.isValid(orderId)) {
        query._id = new ObjectId(orderId);
      } else {
        // Partial ID match handled below via filter
      }
    }

    let orders;
    if (orderId && !ObjectId.isValid(orderId)) {
      // Use aggregation to match partial order ID (last N chars)
      const safeId = orderId.toLowerCase().replace(/[^a-f0-9]/g, '');
      if (safeId.length < 4) {
        return res.status(400).json({ error: 'Order ID must be at least 4 characters' });
      }
      orders = await db.collection('orders')
        .find({ customerEmail: query.customerEmail })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();
      orders = orders.filter((o) => o._id.toString().endsWith(safeId));
    } else {
      orders = await db.collection('orders')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
    }

    // Return only safe fields (no payment intent IDs, no internal metadata)
    const safeOrders = orders.map((o) => ({
      _id: o._id,
      items: (o.items || []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
      total: o.total,
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    }));

    res.json({ orders: safeOrders });
  } catch (err) {
    next(err);
  }
});

// SSE stream for real-time order status updates
// Customer connects: /api/order-status/stream?orderId=abc123
router.get('/stream', (req, res) => {
  const orderId = (req.query.orderId || '').trim();
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx/proxies not to buffer
  });

  // Send initial heartbeat so client knows connection is live
  res.write(': connected\n\n');
  if (typeof res.flush === 'function') res.flush();

  addOrderClient(orderId, res);

  // Keep-alive every 30s to prevent proxy/load-balancer timeouts
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 30000);
  res.on('close', () => clearInterval(heartbeat));
});

module.exports = router;
