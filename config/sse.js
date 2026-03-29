// Server-Sent Events connection manager
// Tracks open SSE connections and broadcasts events to them

// Customer connections: orderId -> Set of response objects
const orderClients = new Map();

// Admin connections: Set of response objects
const adminClients = new Set();

/**
 * Register a customer SSE connection for a specific order.
 */
function addOrderClient(orderId, res) {
  if (!orderClients.has(orderId)) {
    orderClients.set(orderId, new Set());
  }
  orderClients.get(orderId).add(res);

  res.on('close', () => {
    const clients = orderClients.get(orderId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) orderClients.delete(orderId);
    }
  });
}

/**
 * Register an admin SSE connection (watches all orders).
 */
function addAdminClient(res) {
  adminClients.add(res);
  res.on('close', () => adminClients.delete(res));
}

/**
 * Broadcast an order status change to:
 * - Any customers watching that specific order
 * - All connected admin clients
 */
function broadcastOrderUpdate(orderId, data) {
  const payload = `data: ${JSON.stringify({ orderId, ...data })}\n\n`;

  // Notify customers watching this order
  const clients = orderClients.get(orderId);
  if (clients) {
    for (const res of clients) {
      res.write(payload);
    }
  }

  // Notify all admin clients
  for (const res of adminClients) {
    res.write(payload);
  }
}

module.exports = { addOrderClient, addAdminClient, broadcastOrderUpdate };
