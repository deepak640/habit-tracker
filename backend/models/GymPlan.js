const mongoose = require('mongoose');

const MUSCLES = ['chest', 'biceps', 'triceps', 'back', 'shoulders', 'legs', 'arms'];

// The workout planned for one weekday (0 = Monday ... 6 = Sunday): one or two muscles,
// each with a list of exercises, each exercise with sets x reps.
const gymPlanSchema = new mongoose.Schema(
  {
    day: { type: Number, required: true, unique: true, min: 0, max: 6 },
    muscles: [
      {
        _id: false,
        muscle: { type: String, enum: MUSCLES, required: true },
        exercises: [
          {
            _id: false,
            name: { type: String, required: true, trim: true, maxlength: 40 },
            sets: { type: Number, required: true, min: 1, max: 20 },
            reps: { type: Number, required: true, min: 1, max: 100 },
          },
        ],
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('GymPlan', gymPlanSchema);
module.exports.MUSCLES = MUSCLES;
