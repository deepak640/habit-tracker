const mongoose = require('mongoose');

// One phone registered for the daily habit reminder (FCM token + chosen time).
const pushDeviceSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    time: { type: String, default: '21:00', match: /^\d{2}:\d{2}$/ }, // local HH:MM
    tzOffset: { type: Number, default: 0 }, // minutes, same sign as Date#getTimezoneOffset (UTC - local)
    lastSent: { type: String, default: '' }, // local day (YYYY-MM-DD) of the last reminder
  },
  { timestamps: true }
);

module.exports = mongoose.model('PushDevice', pushDeviceSchema);
