/**
 * Pino transport that sends error/fatal logs to a Discord webhook.
 * Used as a pino pipeline target.
 */
const { Transform } = require('stream');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Rate limit: max 1 message per 5 seconds to avoid Discord throttling
let lastSent = 0;
const MIN_INTERVAL_MS = 5000;

function buildDiscordMessage(log) {
  const level = log.level >= 50 ? 'ERROR' : 'FATAL';
  const msg = log.msg || 'No message';
  const stack = log.err?.stack || log.stack || '';

  return {
    embeds: [
      {
        title: `${level === 'FATAL' ? '🔴' : '🟠'} ${level}: ${msg.slice(0, 200)}`,
        description: stack ? `\`\`\`\n${stack.slice(0, 1800)}\n\`\`\`` : undefined,
        color: level === 'FATAL' ? 0xff0000 : 0xff8c00,
        timestamp: new Date(log.time).toISOString(),
        footer: { text: 'Bistro Server' },
      },
    ],
  };
}

async function sendToDiscord(payload) {
  const now = Date.now();
  if (now - lastSent < MIN_INTERVAL_MS) return;
  lastSent = now;

  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Silently fail - don't let Discord issues crash the app
    process.stderr.write(`Discord webhook failed: ${err.message}\n`);
  }
}

module.exports = function () {
  return new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      try {
        const log = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;
        // pino levels: 50 = error, 60 = fatal
        if (log.level >= 50) {
          sendToDiscord(buildDiscordMessage(log));
        }
      } catch {
        // ignore parse errors
      }
      callback(null, chunk);
    },
  });
};
