const router = require('express').Router();
const { getDB } = require('../models/database');
const { ObjectId } = require('mongodb');

// Admin-only middleware
function requireAdmin(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// CSRF protection
function verifyCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

router.use(requireAdmin);

// GET /api/admin/menu — get all categories with items
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const categories = await db.collection('menu_categories').find().toArray();
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/menu/item — add a new item to a category
router.post('/item', verifyCsrf, async (req, res, next) => {
  try {
    const { categoryId, name, description, price } = req.body;
    if (!categoryId || !name || price == null) {
      return res.status(400).json({ error: 'categoryId, name, and price are required' });
    }

    const safeName = String(name).replace(/<[^>]*>/g, '').trim().slice(0, 100);
    const safeDesc = String(description || '').replace(/<[^>]*>/g, '').trim().slice(0, 300);
    const safePrice = Math.round(parseFloat(price) * 100) / 100;

    if (!safeName || safePrice <= 0 || safePrice > 9999) {
      return res.status(400).json({ error: 'Invalid name or price' });
    }

    const itemId = `item_${Date.now()}`;
    const newItem = { id: itemId, name: safeName, description: safeDesc, price: safePrice, image: '' };

    const db = getDB();
    const result = await db.collection('menu_categories').updateOne(
      { id: parseInt(categoryId) },
      { $push: { items: newItem } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.status(201).json(newItem);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/menu/item/:itemId — update an item
router.patch('/item/:itemId', verifyCsrf, async (req, res, next) => {
  try {
    const { name, description, price } = req.body;
    const updates = {};

    if (name !== undefined) {
      const safeName = String(name).replace(/<[^>]*>/g, '').trim().slice(0, 100);
      if (!safeName) return res.status(400).json({ error: 'Name cannot be empty' });
      updates['items.$.name'] = safeName;
    }
    if (description !== undefined) {
      updates['items.$.description'] = String(description).replace(/<[^>]*>/g, '').trim().slice(0, 300);
    }
    if (price !== undefined) {
      const safePrice = Math.round(parseFloat(price) * 100) / 100;
      if (safePrice <= 0 || safePrice > 9999) return res.status(400).json({ error: 'Invalid price' });
      updates['items.$.price'] = safePrice;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const db = getDB();
    const result = await db.collection('menu_categories').updateOne(
      { 'items.id': req.params.itemId },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Item updated' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/menu/item/:itemId — remove an item
router.delete('/item/:itemId', verifyCsrf, async (req, res, next) => {
  try {
    const db = getDB();
    const result = await db.collection('menu_categories').updateOne(
      { 'items.id': req.params.itemId },
      { $pull: { items: { id: req.params.itemId } } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Item deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
