function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let eventSources = [];
let trackedOrders = [];

function closeAllSSE() {
  eventSources.forEach((es) => es.close());
  eventSources = [];
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('lookup-btn').addEventListener('click', lookupOrder);
  document.getElementById('lookup-order-id').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookupOrder();
  });
  document.getElementById('back-btn').addEventListener('click', () => {
    closeAllSSE();
    document.getElementById('lookup-result').classList.add('hidden');
    document.getElementById('lookup-form').classList.remove('hidden');
  });

  // Auto-lookup if email/orderId in URL (from checkout success redirect)
  const params = new URLSearchParams(window.location.search);
  if (params.get('email')) {
    document.getElementById('lookup-email').value = params.get('email');
    if (params.get('orderId')) {
      document.getElementById('lookup-order-id').value = params.get('orderId');
    }
    lookupOrder();
  }
});

async function lookupOrder() {
  const email = document.getElementById('lookup-email').value.trim();
  const orderId = document.getElementById('lookup-order-id').value.trim();
  const errorEl = document.getElementById('lookup-error');
  errorEl.classList.add('hidden');

  if (!email) {
    errorEl.textContent = 'Please enter your email.';
    errorEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('lookup-btn');
  btn.disabled = true;
  btn.textContent = 'Searching...';

  try {
    const params = new URLSearchParams({ email });
    if (orderId) params.set('orderId', orderId);

    const res = await fetch(`/api/order-status?${params}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Order not found');
    }

    if (data.orders.length === 0) {
      throw new Error('No orders found for this email.');
    }

    trackedOrders = data.orders;
    document.getElementById('lookup-form').classList.add('hidden');
    document.getElementById('lookup-result').classList.remove('hidden');

    renderOrders();
    startSSE();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Order';
  }
}

function renderOrders() {
  const container = document.getElementById('order-detail');
  container.innerHTML = trackedOrders.map((order) => {
    const date = new Date(order.createdAt).toLocaleString();
    const items = order.items.map((i) => `${esc(i.name)} x${i.quantity}`).join(', ');
    const shortId = order._id.slice(-6).toUpperCase();

    return `
      <div class="order-result-card" data-order-id="${esc(order._id)}">
        <div class="result-header">
          <span class="order-id">#${esc(shortId)}</span>
          <span class="order-date">${esc(date)}</span>
        </div>
        <div class="result-items">${items}</div>
        <div class="result-bottom">
          <span class="result-total">$${order.total.toFixed(2)}</span>
          <span class="result-status status-${esc(order.status)}">${esc(order.status)}</span>
        </div>
        <p class="live-indicator">Updates live</p>
      </div>
    `;
  }).join('');
}

function startSSE() {
  closeAllSSE(); // close any existing connections before opening new ones

  for (const order of trackedOrders) {
    const es = new EventSource(`/api/order-status/stream?orderId=${encodeURIComponent(order._id)}`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const tracked = trackedOrders.find((o) => o._id === data.orderId);
        if (tracked && data.status) {
          tracked.status = data.status;
          renderOrders();
        }
      } catch {
        // ignore parse errors
      }
    };

    es.addEventListener('shutdown', () => {
      es.close();
      eventSources = eventSources.filter((s) => s !== es);
    });

    es.onerror = () => {
      // Browser auto-reconnects EventSource, nothing to do
    };

    eventSources.push(es); // store every reference, not just the last one
  }
}

// Clean up all SSE connections on page leave
window.addEventListener('beforeunload', closeAllSSE);
