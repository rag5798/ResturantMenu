// Escape HTML to prevent XSS
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Fetch store info and populate address fields
async function loadStoreInfo() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    document.querySelectorAll('.store-address').forEach((el) => {
      el.textContent = config.storeAddress || '';
    });
    document.querySelectorAll('.store-phone').forEach((el) => {
      el.textContent = config.storePhone ? `Phone: ${config.storePhone}` : '';
    });
  } catch {
    // Non-critical — silently fail
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadStoreInfo();

  const params = new URLSearchParams(window.location.search);

  // Returning from Stripe Checkout — verify payment server-side
  if (params.get('success') === 'true') {
    const sessionId = params.get('session_id');
    if (!sessionId) {
      showError('Missing session information. Please contact support.');
      return;
    }

    try {
      const res = await fetch(`/api/payment/verify-session/${encodeURIComponent(sessionId)}`);
      const data = await res.json();

      if (data.verified) {
        sessionStorage.removeItem('cart');
        document.getElementById('checkout-container').classList.add('hidden');
        const successEl = document.getElementById('success-msg');
        // Show personalized confirmation
        if (data.customerName && data.customerName !== 'Guest') {
          document.getElementById('success-name').textContent = `, ${data.customerName}`;
        }
        // Show order items
        if (data.items && data.items.length) {
          const itemsEl = document.getElementById('success-items');
          itemsEl.innerHTML = data.items
            .map((i) => `<div class="summary-row"><span>${esc(i.name)} <span class="qty">x${i.quantity}</span></span><span>$${(i.price * i.quantity).toFixed(2)}</span></div>`)
            .join('');
        }
        if (data.orderTotal) {
          document.getElementById('success-total').textContent = `Total charged: $${data.orderTotal.toFixed(2)}`;
        }
        // Build tracking link with email + short order ID pre-filled
        if (data.orderId && data.customerEmail) {
          const shortId = data.orderId.slice(-6);
          const trackLink = document.getElementById('track-order-link');
          trackLink.href = `/order-status?email=${encodeURIComponent(data.customerEmail)}&orderId=${encodeURIComponent(shortId)}`;
        }
        successEl.classList.remove('hidden');

        // Auto-redirect to order tracking after countdown
        let seconds = 10;
        const countdownEl = document.getElementById('redirect-countdown');
        const trackUrl = document.getElementById('track-order-link').href;
        countdownEl.textContent = `Redirecting to order tracking in ${seconds}s...`;
        const timer = setInterval(() => {
          seconds--;
          if (seconds <= 0) {
            clearInterval(timer);
            window.location.href = trackUrl;
          } else {
            countdownEl.textContent = `Redirecting to order tracking in ${seconds}s...`;
          }
        }, 1000);
      } else {
        showError('We could not verify your payment. If you were charged, please contact support.');
      }
    } catch {
      showError('Unable to verify payment status. Please check your email for confirmation.');
    }
    return;
  }

  if (params.get('cancelled') === 'true') {
    document.getElementById('checkout-container').classList.add('hidden');
    document.getElementById('cancelled-msg').classList.remove('hidden');
    return;
  }

  // Normal checkout flow
  const cart = JSON.parse(sessionStorage.getItem('cart') || '[]');
  if (cart.length === 0) {
    window.location.href = '/';
    return;
  }

  renderSummary(cart);

  document.getElementById('payBtn').addEventListener('click', () => handleCheckout(cart));
});

function showError(message) {
  document.getElementById('checkout-container').classList.add('hidden');
  const errorEl = document.getElementById('verify-error');
  errorEl.querySelector('p').textContent = message;
  errorEl.classList.remove('hidden');
}

function renderSummary(cart) {
  const container = document.getElementById('summary-items');
  container.innerHTML = cart
    .map(
      (item) => `
    <div class="summary-row">
      <span>${esc(item.name)} <span class="qty">x${item.quantity}</span></span>
      <span>$${(item.price * item.quantity).toFixed(2)}</span>
    </div>
  `
    )
    .join('');

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  document.getElementById('summary-total').textContent = `Total: $${total.toFixed(2)}`;
}

async function handleCheckout(cart) {
  const btn = document.getElementById('payBtn');
  const errorEl = document.getElementById('pay-error');
  btn.disabled = true;
  btn.textContent = 'Redirecting to Stripe...';
  errorEl.classList.add('hidden');

  const customerName = document.getElementById('custName').value.trim();
  const customerEmail = document.getElementById('custEmail').value.trim();

  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    errorEl.textContent = 'Please enter a valid email so we can send your order confirmation.';
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Pay with Stripe';
    return;
  }

  try {
    const res = await fetch('/api/payment/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart, customerName, customerEmail }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || err.message || 'Something went wrong');
    }

    const { url } = await res.json();

    // Redirect to Stripe's hosted checkout page
    window.location.href = url;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Pay with Stripe';
  }
}
