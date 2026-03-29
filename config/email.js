const nodemailer = require('nodemailer');
const logger = require('./logger');

// Create reusable transporter
// Supports any SMTP provider: Gmail, SendGrid, Mailgun, etc.
// Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // Email not configured - skip silently
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10) || 587,
    secure: parseInt(SMTP_PORT, 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return transporter;
}

/**
 * Send order confirmation email to customer.
 * Fails silently if email is not configured - never blocks order flow.
 */
async function sendOrderConfirmation(order) {
  const transport = getTransporter();
  if (!transport) {
    logger.warn('Email not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing) - skipping confirmation email');
    return;
  }

  if (!order.customerEmail) {
    logger.info('No customer email on order %s - skipping confirmation', order._id);
    return;
  }

  const itemRows = order.items
    .map((i) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${i.name}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">$${(i.price * i.quantity).toFixed(2)}</td></tr>`)
    .join('');

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#333">
      <h1 style="color:#ff7a59;font-size:24px">Order Confirmed!</h1>
      <p>Hi ${order.customerName || 'there'},</p>
      <p>Thanks for your order at <strong>${process.env.STORE_NAME || 'Bistro'}</strong>. We're preparing your food now.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <thead>
          <tr style="background:#f7f7f7">
            <th style="padding:8px 12px;text-align:left">Item</th>
            <th style="padding:8px 12px;text-align:center">Qty</th>
            <th style="padding:8px 12px;text-align:right">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding:12px;font-weight:700;text-align:right">Total</td>
            <td style="padding:12px;font-weight:700;text-align:right">$${order.total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="color:#888;font-size:14px">If you have any questions about your order, just reply to this email.</p>
      <p style="color:#888;font-size:12px;margin-top:30px">${process.env.STORE_NAME || 'Bistro'}</p>
    </div>
  `;

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: order.customerEmail,
      subject: `${process.env.STORE_NAME || 'Bistro'} - Order Confirmed (#${order._id.toString().slice(-6).toUpperCase()})`,
      html,
    });
    logger.info('Confirmation email sent to %s for order %s', order.customerEmail, order._id);
  } catch (err) {
    // Never let email failure break the order flow
    logger.error(err, 'Failed to send confirmation email for order %s', order._id);
  }
}

module.exports = { sendOrderConfirmation };
