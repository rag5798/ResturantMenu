// ===== State =====
let menu = { categories: [] };
let cart = []; // { id, name, price, quantity }

// Escape HTML to prevent XSS
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  // Load cart from sessionStorage
  const saved = sessionStorage.getItem('cart');
  if (saved) cart = JSON.parse(saved);
  updateCartUI();

  // Event delegation for menu "Add to Order" buttons
  document.getElementById('menucon').addEventListener('click', (e) => {
    const btn = e.target.closest('.add-btn');
    if (!btn) return;
    addToCart(btn.dataset.id, btn.dataset.name, parseFloat(btn.dataset.price));
  });

  // Event delegation for cart +/- buttons
  document.getElementById('cartItems').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-delta]');
    if (!btn) return;
    changeQty(btn.dataset.id, parseInt(btn.dataset.delta, 10));
  });

  // Cart toggle button
  document.getElementById('cartBtn').addEventListener('click', toggleCart);

  // Retry button on menu load error
  document.getElementById('retry-btn').addEventListener('click', () => location.reload());

  // Cart overlay click closes cart
  document.getElementById('cartOverlay').addEventListener('click', toggleCart);

  // Checkout button
  document.getElementById('checkoutBtn').addEventListener('click', goToCheckout);

  // Fetch menu and config in parallel
  try {
    const [menuRes, configRes] = await Promise.all([fetch('/api/menu'), fetch('/api/config')]);
    if (!menuRes.ok) throw new Error('Failed to load menu');
    menu = await menuRes.json();
    buildCategoryTabs();
    renderMenu('all');

    if (configRes.ok) {
      const config = await configRes.json();
      if (config.waitTime) {
        document.getElementById('wait-time-text').textContent = config.waitTime;
        document.getElementById('wait-time-banner').classList.remove('hidden');
      }
    }
  } catch {
    document.getElementById('menucon').classList.add('hidden');
    document.getElementById('menu-error').classList.remove('hidden');
  }
});

// ===== Category tabs =====
function buildCategoryTabs() {
  const container = document.getElementById('categoryTabs');
  menu.categories.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.dataset.category = cat.id;
    btn.textContent = cat.name;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      renderMenu(cat.id);
    });
    container.appendChild(btn);
  });

  // "All" tab click
  container.querySelector('[data-category="all"]').addEventListener('click', (e) => {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    e.target.classList.add('active');
    e.target.setAttribute('aria-selected', 'true');
    renderMenu('all');
  });
}

// ===== Render menu cards =====
function renderMenu(categoryFilter) {
  const container = document.getElementById('menucon');
  container.innerHTML = '';

  const categories =
    categoryFilter === 'all'
      ? menu.categories
      : menu.categories.filter((c) => c.id === categoryFilter);

  categories.forEach((cat) => {
    cat.items.forEach((item) => {
      const soldOut = item.available === false;
      const card = document.createElement('section');
      card.className = soldOut ? 'menu-card sold-out' : 'menu-card';
      card.innerHTML = `
        <img src="https://placehold.co/400x240/1a1f2e/ffb454?text=${encodeURIComponent(item.name)}" alt="${esc(item.name)}">
        <div class="card-body">
          <h3>${esc(item.name)}</h3>
          <p class="desc">${esc(item.description)}</p>
          <p class="price">$${item.price.toFixed(2)}</p>
          ${soldOut
            ? '<span class="sold-out-badge">Sold Out</span>'
            : `<button class="add-btn" data-id="${esc(item.id)}" data-name="${esc(item.name)}" data-price="${item.price}">Add to Order</button>`
          }
        </div>
      `;
      container.appendChild(card);
    });
  });
}

// ===== Cart logic =====
function addToCart(id, name, price) {
  const existing = cart.find((i) => i.id === id);
  if (existing) {
    existing.quantity++;
  } else {
    cart.push({ id, name, price, quantity: 1 });
  }
  saveCart();
  updateCartUI();
  showToast(`${name} added to order`);
}

function changeQty(id, delta) {
  const item = cart.find((i) => i.id === id);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter((i) => i.id !== id);
  }
  saveCart();
  updateCartUI();
}

function saveCart() {
  sessionStorage.setItem('cart', JSON.stringify(cart));
}

function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.quantity, 0);
  document.getElementById('cartCount').textContent = count;

  const container = document.getElementById('cartItems');
  const footer = document.getElementById('cartFooter');
  const empty = document.getElementById('cartEmpty');

  if (cart.length === 0) {
    container.innerHTML = '';
    footer.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  footer.classList.remove('hidden');

  container.innerHTML = cart
    .map(
      (item) => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="name">${esc(item.name)}</div>
        <div class="detail">$${item.price.toFixed(2)} each</div>
      </div>
      <div class="qty-controls">
        <button data-id="${esc(item.id)}" data-delta="-1" aria-label="Remove one ${esc(item.name)}">-</button>
        <span>${item.quantity}</span>
        <button data-id="${esc(item.id)}" data-delta="1" aria-label="Add one ${esc(item.name)}">+</button>
      </div>
    </div>
  `
    )
    .join('');

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  document.getElementById('cartTotal').textContent = `Total: $${total.toFixed(2)}`;
}

// ===== Cart sidebar toggle =====
function toggleCart() {
  const sidebar = document.getElementById('cartSidebar');
  const overlay = document.getElementById('cartOverlay');
  const cartBtn = document.getElementById('cartBtn');
  const isOpen = !sidebar.classList.contains('hidden');

  sidebar.classList.toggle('hidden');
  overlay.classList.toggle('hidden');

  if (isOpen) {
    cartBtn.setAttribute('aria-expanded', 'false');
    cartBtn.focus();
  } else {
    cartBtn.setAttribute('aria-expanded', 'true');
    sidebar.focus();
  }
}

// Close cart on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const sidebar = document.getElementById('cartSidebar');
    if (!sidebar.classList.contains('hidden')) {
      toggleCart();
    }
  }
});

// ===== Toast notifications =====
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

// ===== Refresh menu in background (catches stale sold-out state) =====
async function refreshMenu() {
  try {
    const res = await fetch('/api/menu');
    if (!res.ok) return;
    menu = await res.json();
    // Re-render whichever category tab is currently active
    const activeTab = document.querySelector('.tab.active');
    renderMenu(activeTab ? activeTab.dataset.category : 'all');
  } catch { /* non-critical */ }
}

// Refresh when user returns to this tab (covers stale pages left open)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshMenu();
});

// ===== Checkout =====
async function goToCheckout() {
  if (cart.length === 0) return;

  // Re-fetch menu and validate cart before leaving the page
  try {
    const res = await fetch('/api/menu');
    if (res.ok) menu = await res.json();
  } catch { /* proceed anyway — server will catch it */ }

  const allItems = menu.categories.flatMap((c) => c.items);
  const soldOut = cart.filter((cartItem) => {
    const menuItem = allItems.find((i) => i.id === cartItem.id);
    return menuItem && menuItem.available === false;
  });

  if (soldOut.length > 0) {
    const names = soldOut.map((i) => i.name).join(', ');
    showToast(`${names} ${soldOut.length > 1 ? 'are' : 'is'} sold out — removed from cart`, 'error');
    cart = cart.filter((cartItem) => !soldOut.find((s) => s.id === cartItem.id));
    saveCart();
    updateCartUI();
    // Re-render so sold-out items show their badge
    const activeTab = document.querySelector('.tab.active');
    renderMenu(activeTab ? activeTab.dataset.category : 'all');
    return;
  }

  window.location.href = '/checkout';
}
