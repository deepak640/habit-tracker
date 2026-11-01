const admin = require('firebase-admin');

// Service account JSON lives in the FIREBASE_SERVICE_ACCOUNT env var (works on Vercel).
function messaging() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return null;
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return admin.messaging();
}

module.exports = { messaging };
