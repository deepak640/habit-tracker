# Habit Tracker

A daily habit tracker with weekly and daily progress charts. Check in each day (wake up at 6 AM, DSA practice, workout, or anything you add) and see how the week is going.

The project has two parts:

```
backend/   Node.js + Express + MongoDB API  -> deploy to Vercel
app/       Web UI + Android app (Capacitor) -> talks to the backend over HTTP
```

## Features

- **Dashboard**: pick a day from the week strip, see that day's completion percent, and tick habits off. Each habit shows seven dots for the week and a `n/7` count.
- **Control**: add and remove habits. This is the only place habits are changed.
- **Overall**: a Weekly / Daily switch.
  - Weekly: this week's percent, the last 8 weeks as a bar chart, and a bar per habit.
  - Daily: the average of the days so far, the last 14 days as a bar chart, and a day-by-day grid per habit.
- **Only today can be changed.** Past days are visible but locked, and future days are locked. The server enforces this too.
- Tab switches animate. Animations are turned off if the device has "reduce motion" enabled.

## Project structure

```
backend/
  app.js             Express app and API routes
  server.js          Local entry point (listens on a port)
  db.js              MongoDB connection (cached for serverless) and first-run seed
  api/index.js       Vercel entry point
  vercel.json        Routes every request to api/index.js
  models/            Habit and Log schemas
  .env.example       Environment variables
app/
  public/            Web UI: index.html, style.css, app.js, config.js
  capacitor.config.json
  android/           Android project
```

## Run it locally

You need Node.js and MongoDB.

```bash
# 1. database (from the project root; creates the data folder if needed)
mkdir -p .data
mongod --dbpath .data

# 2. backend (in another terminal)
cd backend
npm install
npm start
```

Open http://localhost:3000. The backend also serves `app/public` when running locally, so this is the whole web app. On first run it creates three habits: Wake up at 6 AM, DSA practice and Workout.

`npm run dev` restarts the server when files change.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/habit-tracker` | MongoDB connection string |
| `PORT` | `3000` | Port for local runs |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/habits` | List habits |
| `POST` | `/api/habits` | Create a habit: `{ "name": "Read" }` |
| `DELETE` | `/api/habits/:id` | Delete a habit and its history |
| `GET` | `/api/logs?from=YYYY-MM-DD&to=YYYY-MM-DD` | Completed check-ins in a date range |
| `PUT` | `/api/logs` | Check in or out: `{ "habit": "<id>", "date": "YYYY-MM-DD", "done": true }` |

`PUT /api/logs` returns `403` for any day other than today. It allows one day either side of the server's date, because Vercel runs in UTC and a phone can be in any timezone.

There is no login. Anyone who knows the URL can read and change the data, so keep the link to yourself.

## Deploy the backend to Vercel (live link)

Vercel cannot run MongoDB, so you need a hosted database.

1. **Create a MongoDB Atlas database.** Make a free cluster at https://www.mongodb.com/atlas, create a database user, and under *Network Access* allow `0.0.0.0/0` (Vercel's IP addresses change). Copy the connection string and add a database name, for example `.../habit-tracker?retryWrites=true&w=majority`.
2. **Push this project to GitHub.**
3. **Import it in Vercel** (https://vercel.com/new):
   - Set **Root Directory** to `backend`.
   - Add an environment variable `MONGO_URI` with the Atlas connection string.
   - Deploy.

   Or with the CLI: `cd backend && npx vercel`, then `npx vercel env add MONGO_URI` and `npx vercel --prod`.
4. **Check it.** Open `https://<your-project>.vercel.app/api/health` (should show `{"ok":true}`) and `/api/habits` (should list your habits).

## Android app

The app loads the UI from `app/public` and calls the backend.

### Point it at your backend

Edit `app/public/config.js`:

```js
window.APP_CONFIG = { apiUrl: 'https://<your-project>.vercel.app' };
```

If `apiUrl` is empty, the app uses `http://10.0.2.2:3000` on the emulator (your computer's local backend). On a real phone with a local backend, open **Control**, tap **Server** and enter `http://<computer-ip>:3000`. A URL entered there overrides `config.js`.

If the app cannot reach the server it shows a red message at the top with the address it tried, and tapping it lets you change the address.

### Build

You need the Android SDK and **JDK 21** (the Capacitor Android build does not work with other JDK versions).

```bash
cd app
npm install
npx cap sync android          # run again after any change in app/public
cd android
JAVA_HOME=/path/to/jdk-21 ./gradlew assembleDebug
```

The APK is written to `app/android/app/build/outputs/apk/debug/app-debug.apk`. You can also run `npm run open` in `app/` and build from Android Studio.

## Notes

- Dates are stored as local `YYYY-MM-DD` strings, one `Log` document per completed habit and day. Unchecking deletes the document.
- Weekly percent is out of a full 7 days, so a new week starts at 0% and fills as you check in.
- `capacitor.config.json` allows plain `http` so the app can reach a local server. Once you use an `https` backend you can turn that off.
