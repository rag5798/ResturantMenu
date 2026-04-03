let orders = [];
let currentFilter = 'all';
let currentPage = 1;
let totalPages = 1;
let csrfToken = '';
let confirmAction = null;
let seenOrderIds = new Set();
let newOrderIds = new Set();

// Escape HTML to prevent XSS
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Toast notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

// Confirm modal
function showConfirm(message, action) {
  document.getElementById('confirm-message').textContent = message;
  confirmAction = action;
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

function cancelConfirm() {
  confirmAction = null;
  document.getElementById('confirm-overlay').classList.add('hidden');
}

function runConfirmAction() {
  const action = confirmAction;
  cancelConfirm();
  if (action) action();
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/auth/status');
    const data = await res.json();

    if (data.authenticated) {
      csrfToken = data.csrfToken || '';
      showDashboard(data.user);
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
});

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');

  if (new URLSearchParams(window.location.search).get('error') === 'unauthorized') {
    document.getElementById('login-error').classList.remove('hidden');
  }
}

function showDashboard(user) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.remove('hidden');

  if (user.photo) document.getElementById('user-photo').src = user.photo;
  document.getElementById('user-name').textContent = user.name;

  // Tab switching
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');

      if (tab.dataset.tab === 'menu-editor') loadMenuEditor();
      if (tab.dataset.tab === 'analytics') loadAnalytics();
      if (tab.dataset.tab === 'orders') loadWaitTime();
    });
  });

  // Order filter buttons
  document.querySelectorAll('.filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.status;
      renderOrders();
    });
  });

  // Add item button
  document.getElementById('add-item-btn').addEventListener('click', addNewItem);

  // Confirm modal
  const overlay = document.getElementById('confirm-overlay');
  const card = overlay.querySelector('.confirm-card');
  overlay.addEventListener('click', cancelConfirm);
  card.addEventListener('click', (e) => e.stopPropagation());
  overlay.querySelector('.confirm-cancel').addEventListener('click', cancelConfirm);
  overlay.querySelector('.confirm-delete').addEventListener('click', runConfirmAction);

  // Event delegation for dynamically rendered order cards
  const ordersList = document.getElementById('orders-list');
  ordersList.addEventListener('change', (e) => {
    const sel = e.target.closest('.status-select');
    if (sel) updateStatus(sel.dataset.id, sel.value);
  });
  ordersList.addEventListener('click', (e) => {
    const refundBtn = e.target.closest('.refund-btn');
    if (refundBtn) { refundOrder(refundBtn.dataset.id); return; }
    const printBtn = e.target.closest('.print-btn');
    if (printBtn) { printTicket(orders.find((o) => o._id === printBtn.dataset.id)); return; }
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) { deleteOrder(deleteBtn.dataset.id); return; }
    const pageBtn = e.target.closest('.page-btn[data-page]');
    if (pageBtn && !pageBtn.disabled) goToPage(parseInt(pageBtn.dataset.page, 10));
  });

  document.getElementById('save-wait-time-btn').addEventListener('click', saveWaitTime);
  document.getElementById('clear-wait-time-btn').addEventListener('click', () => {
    document.getElementById('wait-time-input').value = '';
    saveWaitTime();
  });

  loadOrders();
  loadWaitTime();
  startAdminSSE();
  // Polling as fallback (longer interval since SSE handles real-time)
  const pollInterval = setInterval(loadOrders, 60000);
  window.addEventListener('beforeunload', () => clearInterval(pollInterval));
}

// ========== SSE (real-time order updates) ==========
function startAdminSSE() {
  const es = new EventSource('/api/orders/stream');

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'new_order') {
        // New order came in - reload full list to get it
        loadOrders();
      } else {
        // Status change - update in place if we have the order
        const order = orders.find((o) => o._id === data.orderId);
        if (order) {
          if (data.status) order.status = data.status;
          if (data.paymentStatus) order.paymentStatus = data.paymentStatus;
          renderOrders();
        } else {
          loadOrders();
        }
      }
    } catch {
      // ignore parse errors
    }
  };

  es.addEventListener('shutdown', () => es.close());

  es.onerror = () => {
    // EventSource auto-reconnects; fallback polling covers gaps
  };
}

// ========== ORDERS ==========
async function loadOrders() {
  try {
    const res = await fetch(`/api/orders?page=${currentPage}&limit=20`);
    if (res.status === 401) { showLogin(); return; }
    const data = await res.json();
    orders = data.orders;
    totalPages = data.pages;
    currentPage = data.page;

    // Detect new orders since last load
    const currentIds = new Set(orders.map((o) => o._id));
    if (seenOrderIds.size > 0) {
      for (const id of currentIds) {
        if (!seenOrderIds.has(id)) {
          newOrderIds.add(id);
          setTimeout(() => { newOrderIds.delete(id); renderOrders(); }, 60000);
        }
      }
    }
    seenOrderIds = currentIds;

    renderOrders();
  } catch {
    document.getElementById('orders-list').innerHTML =
      '<p class="no-orders">Failed to load orders.</p>';
  }
}

function renderOrders() {
  const container = document.getElementById('orders-list');
  const filtered = currentFilter === 'all' ? orders : orders.filter((o) => o.status === currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = '<p class="no-orders">No orders found.</p>';
    return;
  }

  const cards = filtered.map((order) => {
    const date = new Date(order.createdAt).toLocaleString();
    const itemsList = order.items.map((i) => `${esc(i.name)} x${i.quantity}`).join(', ');
    const shortId = esc(order._id.slice(-6));

    const isNew = newOrderIds.has(order._id);

    return `
      <div class="order-card${isNew ? ' order-new' : ''}">
        <div class="order-top">
          <span class="order-id">#${shortId}</span>
          ${isNew ? '<span class="new-badge">NEW</span>' : ''}
          <span class="order-date">${esc(date)}</span>
        </div>
        <div class="order-customer">${esc(order.customerName || 'Guest')}</div>
        <div class="order-items">${itemsList}</div>
        ${order.specialInstructions ? `<div class="order-instructions"><strong>Note:</strong> ${esc(order.specialInstructions)}</div>` : ''}
        ${order.paymentError ? `<div class="order-error">Payment error: ${esc(order.paymentError)}</div>` : ''}
        <div class="order-bottom">
          <span class="order-total">$${order.total.toFixed(2)}</span>
          <span class="pay-badge pay-${esc(order.paymentStatus || 'unknown')}">${esc(order.paymentStatus || 'unknown')}</span>
          <span class="status-badge status-${esc(order.status)}">${esc(order.status)}</span>
          <select class="status-select" data-id="${order._id}" aria-label="Update order status">
            ${['pending', 'preparing', 'ready', 'completed', 'cancelled']
              .map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
              .join('')}
          </select>
          ${order.paymentStatus === 'paid' ? `<button class="refund-btn" data-id="${order._id}" aria-label="Refund order">Refund</button>` : ''}
          <button class="print-btn" data-id="${order._id}" aria-label="Print order ticket">Print</button>
          <button class="delete-btn" data-id="${order._id}" aria-label="Delete order">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Pagination controls (only show when more than 1 page)
  let paginationHtml = '';
  if (totalPages > 1) {
    paginationHtml = `
      <div class="pagination">
        <button class="page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="page-info">Page ${currentPage} of ${totalPages}</span>
        <button class="page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
  }

  container.innerHTML = cards + paginationHtml;
}

function goToPage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  loadOrders();
}

async function updateStatus(id, status) {
  try {
    const res = await fetch(`/api/orders/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error();
    showToast(`Order updated to ${status}`);
    await loadOrders();
  } catch {
    showToast('Failed to update status', 'error');
  }
}

function deleteOrder(id) {
  showConfirm('Delete this order?', async () => {
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (!res.ok) throw new Error();
      showToast('Order deleted');
      await loadOrders();
    } catch {
      showToast('Failed to delete order', 'error');
    }
  });
}

function refundOrder(id) {
  showConfirm('Issue a full refund for this order? This cannot be undone.', async () => {
    try {
      const res = await fetch(`/api/orders/${id}/refund`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refund failed');
      showToast('Refund issued successfully');
      await loadOrders();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ========== MENU EDITOR ==========
// ========== Wait Time ==========
async function loadWaitTime() {
  try {
    const res = await fetch('/api/admin/menu/settings/wait-time');
    const data = await res.json();
    const input = document.getElementById('wait-time-input');
    if (input) input.value = data.waitTime || '';
  } catch { /* non-critical */ }
}

async function saveWaitTime() {
  const input = document.getElementById('wait-time-input');
  const waitTime = input ? input.value.trim() : '';
  try {
    const res = await fetch('/api/admin/menu/settings/wait-time', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ waitTime: waitTime || null }),
    });
    if (!res.ok) throw new Error();
    showToast(waitTime ? `Wait time set to "${waitTime}"` : 'Wait time cleared');
  } catch {
    showToast('Failed to save wait time', 'error');
  }
}

// ========== Print Ticket ==========
function printTicket(order) {
  if (!order) return;
  const date = new Date(order.createdAt).toLocaleString();
  const shortId = order._id.slice(-6).toUpperCase();
  const win = window.open('', '_blank', 'width=420,height=620');
  win.document.write(`<!DOCTYPE html><html><head><title>Order #${shortId}</title><style>
    body{font-family:monospace;font-size:14px;margin:24px;color:#000}
    h1{font-size:20px;margin:0 0 4px}
    .sub{font-size:12px;color:#555;margin:0 0 12px}
    hr{border:none;border-top:1px dashed #000;margin:10px 0}
    .row{display:flex;justify-content:space-between;margin:4px 0}
    .total{font-weight:bold}
    .note{font-style:italic;margin-top:10px;font-size:13px}
    .footer{text-align:center;margin-top:16px;font-size:12px;color:#555}
  </style></head><body>
    <h1>Order #${shortId}</h1>
    <p class="sub">${esc(date)} &mdash; ${esc(order.customerName || 'Guest')}</p>
    <hr>
    ${order.items.map((i) => `<div class="row"><span>${esc(i.name)} &times;${i.quantity}</span><span>$${(i.price * i.quantity).toFixed(2)}</span></div>`).join('')}
    <hr>
    <div class="row total"><span>Total</span><span>$${order.total.toFixed(2)}</span></div>
    ${order.specialInstructions ? `<p class="note">Note: ${esc(order.specialInstructions)}</p>` : ''}
    <p class="footer">Thank you!</p>
    <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
  </body></html>`);
  win.document.close();
}

// ========== Analytics ==========
async function loadAnalytics() {
  const container = document.getElementById('analytics-content');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading analytics...</p></div>';

  try {
    const res = await fetch('/api/orders/analytics');
    if (!res.ok) throw new Error('Failed to load analytics');
    const data = await res.json();

    const fmt = (n) => `$${Number(n).toFixed(2)}`;

    container.innerHTML = `
      <div class="analytics-summary">
        <div class="summary-card">
          <div class="summary-label">Today</div>
          <div class="summary-value">${fmt(data.today.revenue)}</div>
          <div class="summary-sub">${data.today.orders} order${data.today.orders !== 1 ? 's' : ''}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">This Week</div>
          <div class="summary-value">${fmt(data.thisWeek.revenue)}</div>
          <div class="summary-sub">${data.thisWeek.orders} order${data.thisWeek.orders !== 1 ? 's' : ''}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">All Time</div>
          <div class="summary-value">${fmt(data.allTime.revenue)}</div>
          <div class="summary-sub">${data.allTime.orders} order${data.allTime.orders !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div class="analytics-section">
        <h2>Best Selling Items</h2>
        ${data.topItems.length === 0
          ? '<p class="muted-note">No paid orders yet.</p>'
          : `<table class="analytics-table">
              <thead><tr><th>#</th><th>Item</th><th>Units Sold</th><th>Revenue</th></tr></thead>
              <tbody>
                ${data.topItems.map((item, i) => `
                  <tr>
                    <td class="rank">${i + 1}</td>
                    <td>${esc(item._id)}</td>
                    <td>${item.unitsSold}</td>
                    <td>${fmt(item.revenue)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>`
        }
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="error">Failed to load analytics.</p>`;
  }
}

let menuCategories = [];

async function loadMenuEditor() {
  const container = document.getElementById('menu-items-list');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading menu...</p></div>';

  try {
    const res = await fetch('/api/admin/menu');
    if (!res.ok) throw new Error();
    const data = await res.json();
    menuCategories = data.categories;

    // Populate category dropdown
    const select = document.getElementById('new-category');
    select.innerHTML = menuCategories
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join('');

    renderMenuEditor();

    // Event delegation for menu editor (avoids CSP-blocked inline onclick)
    const itemsList = document.getElementById('menu-items-list');
    itemsList.replaceWith(itemsList.cloneNode(true)); // remove old listeners if re-loading
    document.getElementById('menu-items-list').addEventListener('click', (e) => {
      const saveBtn = e.target.closest('.save-item-btn');
      if (saveBtn) { saveItem(saveBtn.dataset.itemId, saveBtn); return; }
      const delBtn = e.target.closest('.delete-item-btn');
      if (delBtn) { deleteItem(delBtn.dataset.itemId); return; }
      const availBtn = e.target.closest('.avail-btn');
      if (availBtn) { toggleAvailability(availBtn.dataset.itemId, availBtn.dataset.available === 'true'); return; }
    });
  } catch {
    container.innerHTML = '<p class="no-orders">Failed to load menu.</p>';
  }
}

function renderMenuEditor() {
  const container = document.getElementById('menu-items-list');

  if (menuCategories.length === 0) {
    container.innerHTML = '<p class="no-orders">No menu categories found.</p>';
    return;
  }

  container.innerHTML = menuCategories.map((cat) => `
    <div class="menu-edit-category">
      <h3>${esc(cat.name)}</h3>
      ${cat.items.map((item) => `
        <div class="menu-edit-item" data-item-id="${esc(item.id)}">
          <div class="item-fields">
            <input class="field-name" type="text" value="${esc(item.name)}" aria-label="Item name" />
            <input class="field-desc" type="text" value="${esc(item.description)}" aria-label="Description" />
            <input class="field-price" type="number" step="0.01" min="0.01" value="${item.price}" aria-label="Price" />
          </div>
          <div class="item-actions">
            <button class="avail-btn ${item.available === false ? 'btn-soldout' : 'btn-available'}" data-item-id="${esc(item.id)}" data-available="${item.available === false ? 'false' : 'true'}">${item.available === false ? 'Unavailable' : 'Available'}</button>
            <button class="save-item-btn" data-item-id="${esc(item.id)}">Save</button>
            <button class="delete-item-btn" data-item-id="${esc(item.id)}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

async function addNewItem() {
  const categoryId = document.getElementById('new-category').value;
  const name = document.getElementById('new-name').value.trim();
  const description = document.getElementById('new-desc').value.trim();
  const price = document.getElementById('new-price').value;

  if (!name || !price) {
    showToast('Name and price are required', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/menu/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ categoryId, name, description, price: parseFloat(price) }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed');
    }

    // Clear form
    document.getElementById('new-name').value = '';
    document.getElementById('new-desc').value = '';
    document.getElementById('new-price').value = '';

    showToast(`${name} added to menu`);
    await loadMenuEditor();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveItem(itemId, btn) {
  const row = btn.closest('.menu-edit-item');
  const name = row.querySelector('.field-name').value.trim();
  const description = row.querySelector('.field-desc').value.trim();
  const price = parseFloat(row.querySelector('.field-price').value);

  if (!name || !price || price <= 0) {
    showToast('Name and valid price required', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/admin/menu/item/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ name, description, price }),
    });
    if (!res.ok) throw new Error();
    showToast('Item updated');
    await loadMenuEditor();
  } catch {
    showToast('Failed to save item', 'error');
  }
}

function deleteItem(itemId) {
  showConfirm('Delete this menu item?', async () => {
    try {
      const res = await fetch(`/api/admin/menu/item/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (!res.ok) throw new Error();
      showToast('Item deleted');
      await loadMenuEditor();
    } catch {
      showToast('Failed to delete item', 'error');
    }
  });
}

async function toggleAvailability(itemId, currentlyAvailable) {
  try {
    const res = await fetch(`/api/admin/menu/item/${encodeURIComponent(itemId)}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ available: !currentlyAvailable }),
    });
    if (!res.ok) throw new Error();
    showToast(currentlyAvailable ? 'Item marked as sold out' : 'Item marked as available');
    await loadMenuEditor();
  } catch {
    showToast('Failed to update availability', 'error');
  }
}
