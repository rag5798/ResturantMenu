/**
 * MongoDB backup script for free-tier Atlas clusters.
 * Exports all collections as JSON to ./backups/<timestamp>/
 *
 * Usage: node scripts/backup.js
 *
 * Requires: MONGODB_URI and MONGODB_DB_NAME in .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

async function backup() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;
  if (!uri || !dbName) {
    console.error('Missing MONGODB_URI or MONGODB_DB_NAME in .env');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups', timestamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();

    console.log(`Backing up ${collections.length} collections to ${backupDir}`);

    for (const col of collections) {
      const name = col.name;
      const docs = await db.collection(name).find().toArray();
      const filePath = path.join(backupDir, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
      console.log(`  ${name}: ${docs.length} documents`);
    }

    console.log('Backup complete.');
  } catch (err) {
    console.error('Backup failed:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

backup();
