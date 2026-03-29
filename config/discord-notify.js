/**
 * Send order notifications to Discord.
 * Reuses the same DISCORD_WEBHOOK_URL used for error alerts.
 * Fails silently — never blocks order processing.
 */

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function notifyNewOrder(order) {
  if (!DISCORD_WEBHOOK_URL) return;

  const itemLines = order.items
    .map((i) => `• ${i.name} x${i.quantity} — $${(i.price * i.quantity).toFixed(2)}`)
    .join('\n');

  const shortId = order._id.toString().slice(-6);

  const payload = {
    embeds: [
      {
        title: `🧾 New Order #${shortId}`,
        color: 0x50dc78,
        fields: [
          { name: 'Customer', value: order.customerName || 'Guest', inline: true },
          { name: 'Total', value: `$${order.total.toFixed(2)}`, inline: true },
          { name: 'Items', value: itemLines.slice(0, 1024) },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Bistro Orders' },
      },
    ],
  };

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Silently fail — Discord issues should never affect orders
  }
}

module.exports = { notifyNewOrder };
