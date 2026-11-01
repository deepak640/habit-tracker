const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

// Service account JSON lives in the FIREBASE_SERVICE_ACCOUNT env var (works on Vercel).
function messaging() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (!getApps().length) {
    let key = JSON.parse(raw.trim());
    if (typeof key === 'string') key = JSON.parse(key); // value pasted with surrounding quotes
    if (!key.private_key || !key.client_email) throw new Error(`key has no private_key/client_email (fields: ${Object.keys(key).join(',')})`);
    initializeApp({ credential: cert(key) });
  }
  return getMessaging();
}

module.exports = { messaging };
