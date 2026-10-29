const mongoose = require('mongoose');

// One document per completed (habit, day). Unchecking deletes the document.
const logSchema = new mongoose.Schema({
  habit: { type: mongoose.Schema.Types.ObjectId, ref: 'Habit', required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // local day, YYYY-MM-DD
});

logSchema.index({ habit: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Log', logSchema);
