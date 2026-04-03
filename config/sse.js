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
      try {
        res.write(payload);
        if (typeof res.flush === 'function') res.flush();
      } catch {
        clients.delete(res); // dead connection — remove it
      }
    }
    if (clients.size === 0) orderClients.delete(orderId);
  }

  // Notify all admin clients
  for (const res of adminClients) {
    try {
      res.write(payload);
      if (typeof res.flush === 'function') res.flush();
    } catch {
      adminClients.delete(res); // dead connection — remove it
    }
  }
}

/**
 * Close all open SSE connections. Called during server shutdown so
 * server.close() can complete without waiting for long-lived connections.
 * Sends a final 'shutdown' event so browsers know not to immediately retry.
 */
function closeAllConnections() {
  const shutdownMsg = `event: shutdown\ndata: {}\n\n`;

  for (const clients of orderClients.values()) {
    for (const res of clients) {
      try { res.write(shutdownMsg); res.end(); } catch { /* already closed */ }
    }
  }
  for (const res of adminClients) {
    try { res.write(shutdownMsg); res.end(); } catch { /* already closed */ }
  }

  orderClients.clear();
  adminClients.clear();
}

module.exports = { addOrderClient, addAdminClient, broadcastOrderUpdate, closeAllConnections };
