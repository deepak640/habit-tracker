const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const Habit = require('./models/Habit');
const Log = require('./models/Log');
const DietMessage = require('./models/DietMessage');
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

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${DIET_PROMPT} Today's date is ${today}; restart the daily total each new day.` }] },
        contents: recent.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      }),
    });
    if (!r.ok) {
      console.error('Gemini error', r.status, await r.text());
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

module.exports = app;
