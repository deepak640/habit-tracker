// Local entry point. On Vercel the app is exported from api/index.js instead.
const app = require('./app');
const { connect } = require('./db');

const PORT = process.env.PORT || 3000;

connect()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Habit tracker on http://localhost:${PORT}`)))
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
