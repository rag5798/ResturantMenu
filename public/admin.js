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

  loadOrders();
  startAdminSSE();
  // Polling as fallback (longer interval since SSE handles real-time)
  setInterval(loadOrders, 60000);
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
        ${order.paymentError ? `<div class="order-error">Payment error: ${esc(order.paymentError)}</div>` : ''}
        <div class="order-bottom">
          <span class="order-total">$${order.total.toFixed(2)}</span>
          <span class="pay-badge pay-${esc(order.paymentStatus || 'unknown')}">${esc(order.paymentStatus || 'unknown')}</span>
          <span class="status-badge status-${esc(order.status)}">${esc(order.status)}</span>
          <select class="status-select" onchange="updateStatus('${order._id}', this.value)" aria-label="Update order status">
            ${['pending', 'preparing', 'ready', 'completed', 'cancelled']
              .map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
              .join('')}
          </select>
          ${order.paymentStatus === 'paid' ? `<button class="refund-btn" onclick="refundOrder('${order._id}')" aria-label="Refund order">Refund</button>` : ''}
          <button class="delete-btn" onclick="deleteOrder('${order._id}')" aria-label="Delete order">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Pagination controls (only show when more than 1 page)
  let paginationHtml = '';
  if (totalPages > 1) {
    paginationHtml = `
      <div class="pagination">
        <button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="page-info">Page ${currentPage} of ${totalPages}</span>
        <button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
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
            <button class="save-item-btn" onclick="saveItem('${esc(item.id)}', this)">Save</button>
            <button class="delete-btn" onclick="deleteItem('${esc(item.id)}')">Delete</button>
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
