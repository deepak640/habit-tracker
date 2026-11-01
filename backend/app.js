const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const Habit = require('./models/Habit');
const Log = require('./models/Log');
const DietMessage = require('./models/DietMessage');
const PushDevice = require('./models/PushDevice');
const { messaging } = require('./push');
const { connect } = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const app = express();

app.use((req, res, next) => {
  // The Android app and any separately hosted web UI call this API cross-origin.
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json());

// Local convenience: serve the web UI from ../app/public when that folder exists.
// It is absent when only backend/ is deployed (e.g. on Vercel), so this is skipped there.
const uiDir = path.join(__dirname, '..', 'app', 'public');
if (!process.env.VERCEL && fs.existsSync(uiDir)) app.use(express.static(uiDir));

app.get('/', (req, res) => res.json({ ok: true, service: 'habit-tracker-api' }));

// Every /api route needs the database; connect lazily so serverless cold starts work.
app.use('/api', async (req, res, next) => {
  try {
    await connect();
    next();
  } catch (err) {
    next(err);
  }
});

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get(
  '/api/habits',
  wrap(async (req, res) => {
    res.json(await Habit.find().sort({ order: 1, createdAt: 1 }));
  })
);

app.post(
  '/api/habits',
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const order = await Habit.countDocuments();
    const habit = await Habit.create({ name, emoji: req.body.emoji || '✨', order });
    res.status(201).json(habit);
  })
);

app.delete(
  '/api/habits/:id',
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    await Habit.findByIdAndDelete(req.params.id);
    await Log.deleteMany({ habit: req.params.id });
    res.status(204).end();
  })
);

// Logs for a date range (inclusive): /api/logs?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get(
  '/api/logs',
  wrap(async (req, res) => {
    const { from, to } = req.query;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
    }
    const logs = await Log.find({ date: { $gte: from, $lte: to } });
    res.json(logs.map((l) => ({ habit: l.habit, date: l.date })));
  })
);

const isoDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Only today can be changed. Allow one day either side: hosts like Vercel run in UTC,
// and a phone can be in any timezone, so the server's "today" can differ by a day.
function isEditableDay(date) {
  const now = new Date();
  const day = (offset) => isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  return date >= day(-1) && date <= day(1);
}

// Set a check-in on or off: { habit, date, done }
app.put(
  '/api/logs',
  wrap(async (req, res) => {
    const { habit, date, done } = req.body;
    if (!mongoose.isValidObjectId(habit) || !DATE_RE.test(date)) {
      return res.status(400).json({ error: 'invalid habit or date' });
    }
    if (!isEditableDay(date)) return res.status(403).json({ error: 'only today can be changed' });
    if (done) await Log.updateOne({ habit, date }, { habit, date }, { upsert: true });
    else await Log.deleteOne({ habit, date });
    res.json({ habit, date, done: !!done });
  })
);

// ---- Diet chat (Gemini) ----

// Tried in order; the next one is used when a model is overloaded (503), missing (404) or slow.
const GEMINI_MODELS = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash').split(',');
const DIET_CONTEXT = 30; // most recent messages sent to Gemini
const DIET_PROMPT =
  'You are a friendly nutrition coach inside a habit tracker app. The user tells you what they ate or asks about food. ' +
  'Estimate calories and protein (grams) for each item, then give the running total for the day so far. ' +
  'Keep replies short and phone-friendly, plain text with simple lists, no markdown tables. ' +
  'If a portion is unclear, assume a typical serving and say so. Do not give medical advice.';

app.get(
  '/api/diet',
  wrap(async (req, res) => {
    const msgs = await DietMessage.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs.reverse().map((m) => ({ _id: m._id, role: m.role, text: m.text, createdAt: m.createdAt })));
  })
);

app.post(
  '/api/diet',
  wrap(async (req, res) => {
    const text = String(req.body.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY is not set' });

    const user = await DietMessage.create({ role: 'user', text });
    const recent = (await DietMessage.find().sort({ createdAt: -1 }).limit(DIET_CONTEXT)).reverse();
    const today = String(req.body.date || '').match(DATE_RE) ? req.body.date : isoDay(new Date());

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: `${DIET_PROMPT} Today's date is ${today}; restart the daily total each new day.` }] },
      contents: recent.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    });
    let r;
    for (const model of GEMINI_MODELS) {
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body,
          signal: AbortSignal.timeout(9000),
        });
      } catch (err) {
        console.error('Gemini', model, err.name);
        r = null;
        continue;
      }
      if (r.ok) break;
      console.error('Gemini', model, r.status, await r.text());
    }
    if (!r?.ok) {
      await DietMessage.findByIdAndDelete(user._id); // keep history free of unanswered messages
      return res.status(502).json({ error: 'gemini request failed' });
    }
    const data = await r.json();
    const reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
    if (!reply) {
      await DietMessage.findByIdAndDelete(user._id);
      return res.status(502).json({ error: 'empty reply from gemini' });
    }
    const model = await DietMessage.create({ role: 'model', text: reply });
    res.status(201).json({ user, model });
  })
);

app.delete(
  '/api/diet',
  wrap(async (req, res) => {
    await DietMessage.deleteMany({});
    res.status(204).end();
  })
);

// ---------- Push reminders ----------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Phone registers (or updates) its FCM token, reminder time and on/off state.
app.put(
  '/api/push',
  wrap(async (req, res) => {
    const token = String(req.body.token || '').trim();
    if (!token) return res.status(400).json({ error: 'token is required' });
    const set = { enabled: req.body.enabled !== false };
    if (TIME_RE.test(req.body.time)) set.time = req.body.time;
    if (Number.isFinite(req.body.tzOffset)) set.tzOffset = req.body.tzOffset;
    await PushDevice.findOneAndUpdate({ token }, { $set: set }, { upsert: true });
    res.status(204).end();
  })
);

// Hit this every minute from an external cron (cron-job.org etc.) with ?key=CRON_SECRET.
// A device is due once its local clock passes its reminder time and it has not been sent today.
app.get(
  '/api/push/cron',
  wrap(async (req, res) => {
    if (!process.env.CRON_SECRET || req.query.key !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
    let fcm;
    try {
      fcm = messaging();
    } catch (err) {
      console.error('Firebase init', err.message);
      return res.status(500).json({ error: 'firebase init failed: ' + err.message.slice(0, 120) });
    }
    if (!fcm) return res.status(503).json({ error: 'FIREBASE_SERVICE_ACCOUNT is not set' });

    const now = Date.now();
    const habitCount = await Habit.countDocuments();
    let sent = 0;
    for (const d of await PushDevice.find({ enabled: true })) {
      const local = new Date(now - d.tzOffset * 60000).toISOString(); // shifted clock, read as UTC
      const day = local.slice(0, 10);
      if (d.lastSent === day || local.slice(11, 16) < d.time) continue;

      const done = await Log.countDocuments({ date: day });
      const left = Math.max(habitCount - done, 0);
      const notification =
        habitCount && !left
          ? { title: 'All done today 🎉', body: 'Every habit checked off. Nice work!' }
          : { title: 'Habit check-in', body: left ? `${left} habit${left === 1 ? '' : 's'} left today. You got this!` : 'Time to check your habits.' };
      try {
        await fcm.send({ token: d.token, notification, android: { priority: 'high' } });
        d.lastSent = day;
        await d.save();
        sent++;
      } catch (err) {
        console.error('FCM', err.code);
        if (err.code === 'messaging/registration-token-not-registered') await d.deleteOne();
      }
    }
    res.json({ sent });
  })
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

module.exports = app;
