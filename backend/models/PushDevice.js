const mongoose = require('mongoose');

// One phone registered for habit reminders (FCM token + chosen interval).
const pushDeviceSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    tzOffset: { type: Number, default: 0 }, // minutes, same sign as Date#getTimezoneOffset (UTC - local)
    everyHours: { type: Number, default: 3 }, // reminder every N hours between 08:00 and 22:00 local
    lastSentAt: { type: Date }, // last interval reminder
  },
  { timestamps: true }
);

module.exports = mongoose.model('PushDevice', pushDeviceSchema);
