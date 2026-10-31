const mongoose = require('mongoose');

// One chat message in the diet conversation. role follows Gemini: 'user' or 'model'.
const dietMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'model'], required: true },
    text: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('DietMessage', dietMessageSchema);
