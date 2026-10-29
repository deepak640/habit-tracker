const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const Habit = require('./models/Habit');
const Log = require('./models/Log');
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

module.exports = app;
