/**
 * Seed the menu collection in MongoDB with the default menu data.
 * Run: node scripts/seed-menu.js
 *
 * Only inserts if the menu collection is empty (won't overwrite edits).
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const menuData = require('../models/menu');

async function seed() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);

  const existing = await db.collection('menu_categories').countDocuments();
  if (existing > 0) {
    console.log(`Menu already has ${existing} categories - skipping seed. Use --force to overwrite.`);
    if (!process.argv.includes('--force')) {
      await client.close();
      return;
    }
    console.log('--force flag detected - replacing menu data...');
    await db.collection('menu_categories').deleteMany({});
  }

  await db.collection('menu_categories').insertMany(menuData.categories);
  console.log(`Seeded ${menuData.categories.length} categories with ${menuData.categories.reduce((s, c) => s + c.items.length, 0)} items.`);

  await client.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
