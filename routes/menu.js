const router = require('express').Router();
const { getDB } = require('../models/database');
const menuDataFallback = require('../models/menu');

// GET /api/menu - Get full menu from DB (falls back to hardcoded data)
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const categories = await db.collection('menu_categories').find().toArray();
    if (categories.length > 0) {
      res.json({ categories });
    } else {
      res.json(menuDataFallback);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/menu/category/:categoryId - Get items by category
router.get('/category/:categoryId', async (req, res, next) => {
  try {
    const db = getDB();
    const category = await db.collection('menu_categories').findOne({
      id: parseInt(req.params.categoryId),
    });
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(category);
  } catch (err) {
    next(err);
  }
});

// GET /api/menu/item/:itemId - Get a single item
router.get('/item/:itemId', async (req, res, next) => {
  try {
    const db = getDB();
    const category = await db.collection('menu_categories').findOne({
      'items.id': req.params.itemId,
    });
    if (category) {
      const item = category.items.find((i) => i.id === req.params.itemId);
      return res.json({ ...item, category: category.name });
    }
    res.status(404).json({ error: 'Item not found' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
