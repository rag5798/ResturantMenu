const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback',
    },
    (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email || !ADMIN_EMAILS.includes(email)) {
        return done(null, false, { message: 'Not an authorized admin' });
      }
      done(null, {
        id: profile.id,
        name: profile.displayName,
        email,
        photo: profile.photos?.[0]?.value,
      });
    }
  )
);

module.exports = passport;
