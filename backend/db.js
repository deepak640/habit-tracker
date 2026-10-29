const mongoose = require('mongoose');
const Habit = require('./models/Habit');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/habit-tracker';

// Keep the connection on `global` so serverless invocations reuse it instead of reconnecting.
const cache = global._habitMongo || (global._habitMongo = { promise: null });

async function seedDefaults() {
  if (await Habit.countDocuments()) return;
  await Habit.insertMany([
    { name: 'Wake up at 6 AM', emoji: '⏰', order: 0 },
    { name: 'DSA practice', emoji: '🧠', order: 1 },
    { name: 'Workout', emoji: '💪', order: 2 },
  ]);
}

function connect() {
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 })
      .then(seedDefaults)
      .catch((err) => {
        cache.promise = null; // allow a retry on the next request
        throw err;
      });
  }
  return cache.promise;
}

module.exports = { connect };
