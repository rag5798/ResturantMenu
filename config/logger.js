const pino = require('pino');
const path = require('path');

const targets = [];

// Pretty console output in development
if (process.env.NODE_ENV !== 'production') {
  targets.push({
    target: 'pino-pretty',
    options: { colorize: true },
    level: process.env.LOG_LEVEL || 'info',
  });
} else {
  // Rotating log file in production (daily, keep 14 days)
  targets.push({
    target: 'pino-roll',
    options: {
      file: path.join(__dirname, '..', 'logs', 'app.log'),
      frequency: 'daily',
      limit: { count: 14 },
      mkdir: true,
    },
    level: process.env.LOG_LEVEL || 'info',
  });
}

// Discord alerts for error/fatal (if webhook URL is configured)
if (process.env.DISCORD_WEBHOOK_URL) {
  targets.push({
    target: require('path').join(__dirname, 'discord-transport.js'),
    options: {},
    level: 'error', // only error (50) and fatal (60)
  });
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets },
});

module.exports = logger;
