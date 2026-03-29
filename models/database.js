// db.js
const { MongoClient } = require("mongodb");
const logger = require("../config/logger");

let client;
let db;

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI in environment variables.");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await client.connect();

      db = client.db(process.env.MONGODB_DB_NAME);

      // Auto-delete processed webhook events after 7 days
      await db.collection('processed_events').createIndex(
        { processedAt: 1 },
        { expireAfterSeconds: 7 * 24 * 60 * 60 }
      );

      // Indexes for common order queries
      await db.collection('orders').createIndex({ stripeSessionId: 1 });
      await db.collection('orders').createIndex({ paymentIntentId: 1 });
      await db.collection('orders').createIndex({ customerEmail: 1 });
      await db.collection('orders').createIndex({ createdAt: -1 });
      await db.collection('orders').createIndex({ status: 1 });

      logger.info("MongoDB connected successfully");
      return db;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        logger.error(err, "MongoDB connection failed after %d attempts", MAX_RETRIES);
        throw err;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s, 16s
      logger.warn("MongoDB connection attempt %d/%d failed - retrying in %dms", attempt, MAX_RETRIES, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function getDB() {
  if (!db) throw new Error("DB not initialized. Call connectDB() first.");
  return db;
}

async function closeDB() {
  if (client) await client.close();
}

module.exports = { connectDB, getDB, closeDB };
