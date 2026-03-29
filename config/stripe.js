require('dotenv').config();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY is not set in .env - payments will not work');
}

module.exports = {
  stripeSecretKey
};
