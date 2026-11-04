const mongoose = require('mongoose');

// Reps done for one set of one exercise on one day. A set that is unticked has no document.
const gymLogSchema = new mongoose.Schema({
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // local day, YYYY-MM-DD
  muscle: { type: String, required: true },
  exercise: { type: String, required: true, maxlength: 40 },
  set: { type: Number, required: true, min: 0, max: 19 }, // 0-based set number
  reps: { type: Number, required: true, min: 1, max: 100 },
});

gymLogSchema.index({ date: 1, muscle: 1, exercise: 1, set: 1 }, { unique: true });

module.exports = mongoose.model('GymLog', gymLogSchema);
