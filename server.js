require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const logger = require('./config/logger');
const passport = require('./config/passport');
const { connectDB, closeDB, getDB } = require('./models/database');
const { closeAllConnections } = require('./config/sse');

// Create an instance of an Express application
const app = express();
const port = process.env.PORT || 3000;

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://js.stripe.com'],
        frameSrc: ["'self'", 'https://js.stripe.com'],
        imgSrc: ["'self'", 'https://placehold.co', 'https://*.googleusercontent.com', 'data:'],
        connectSrc: ["'self'", 'https://api.stripe.com'],
        styleSrc: ["'self'"],
      },
    },
  })
);

// Gzip/brotli compression (skip SSE — gzip buffers data, breaking streaming)
app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept && req.headers.accept.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));

// HTTP request logging
app.use(morgan('short', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// Stripe webhook needs raw body BEFORE json parsing
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Middleware
app.use(bodyParser.json({ limit: '16kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session (in-memory — admin re-logs in if server restarts, no big deal)
app.use(
  session({
    secret: process.env.SESSION_SECRET || (() => { throw new Error('SESSION_SECRET is not set in .env'); })(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Rate limit on payment endpoint (5 requests per minute per IP)
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many payment requests. Please wait a minute.' },
});
app.use('/api/payment/create', paymentLimiter);

// Rate limit on admin endpoints (30 requests per minute per IP)
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/orders', adminLimiter);

// Rate limit on public endpoints (60 requests per minute per IP)
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/menu', publicLimiter);
app.use('/api/config', publicLimiter);
app.use('/api/order-status', publicLimiter);

// Auth routes
app.use('/auth', require('./routes/auth'));

// API Routes
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/admin/menu', require('./routes/admin-menu'));
app.use('/api/order-status', require('./routes/order-status'));

// Serve pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});
app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/order-status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'order-status.html'));
});

// Expose public config to frontend (includes live wait time from DB)
app.get('/api/config', async (req, res, next) => {
  try {
    const db = getDB();
    const waitSetting = await db.collection('settings').findOne({ key: 'waitTime' });
    res.json({
      stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
      storeName: process.env.STORE_NAME || 'Bistro',
      storeAddress: process.env.STORE_ADDRESS || '',
      storePhone: process.env.STORE_PHONE || '',
      waitTime: waitSetting?.value || null,
    });
  } catch (err) {
    next(err);
  }
});

// Health check — verifies DB connection is alive
app.get('/health', async (req, res) => {
  try {
    const db = getDB();
    await db.command({ ping: 1 });
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch (err) {
    logger.error(err, 'Health check failed');
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// 404 catch-all — must be after all valid routes
app.use((req, res) => {
  // JSON response for API requests, HTML page for browser requests
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: true, message: 'Endpoint not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Error Handler
app.use((err, req, res, next) => {
  logger.error(err, 'Unhandled server error');
  const status = err.status || 500;
  res.status(status).json({
    error: true,
    message: status >= 500 ? 'Internal Server Error' : err.message,
  });
});

// Clean up abandoned orders (awaiting_payment > 1 hour old)
let cleanupInterval;
async function cleanupAbandonedOrders() {
  try {
    const db = getDB();
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const result = await db.collection('orders').deleteMany({
      paymentStatus: 'awaiting_payment',
      createdAt: { $lt: cutoff },
    });
    if (result.deletedCount > 0) {
      logger.info('Cleaned up %d abandoned orders', result.deletedCount);
    }
  } catch (err) {
    logger.error(err, 'Abandoned order cleanup failed');
  }
}

// Start server
const server = app.listen(port, async () => {
  await connectDB();
  cleanupAbandonedOrders();
  cleanupInterval = setInterval(cleanupAbandonedOrders, 60 * 60 * 1000);
  logger.info(`Server running on http://localhost:${port}`);
  logger.info(`Admin dashboard: http://localhost:${port}/admin`);
});

// Graceful shutdown
function shutdown(signal) {
  logger.info(`${signal} received - shutting down gracefully`);
  clearInterval(cleanupInterval);
  closeAllConnections(); // drain SSE before server.close() so it doesn't hang
  server.closeAllConnections(); // close all sockets immediately so server.close() doesn't wait
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await closeDB();
      logger.info('MongoDB connection closed');
    } catch (err) {
      logger.error(err, 'Error closing MongoDB');
    }
    process.exit(0);
  });

  // Force exit if shutdown takes too long
  setTimeout(() => {
    logger.error('Forced shutdown - timed out after 10s');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch any async error that escapes a try/catch — log it but don't crash
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

// Catch synchronous throws that escape all handlers — log then exit cleanly
process.on('uncaughtException', (err) => {
  logger.fatal(err, 'Uncaught exception — shutting down');
  shutdown('uncaughtException');
});
