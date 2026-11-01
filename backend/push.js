const admin = require('firebase-admin');

// Service account JSON lives in the FIREBASE_SERVICE_ACCOUNT env var (works on Vercel).
function messaging() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (!admin.apps.length) {
    let key = JSON.parse(raw.trim());
    if (typeof key === 'string') key = JSON.parse(key); // value pasted with surrounding quotes
    if (!key.private_key || !key.client_email) throw new Error(`key has no private_key/client_email (fields: ${Object.keys(key).join(',')})`);
    admin.initializeApp({ credential: admin.credential.cert(key) });
  }
  return admin.messaging();
}

module.exports = { messaging };
