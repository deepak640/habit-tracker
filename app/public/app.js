const $ = (id) => document.getElementById(id);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// [strong, pastel] per habit
const COLORS = [
  ['#4c6ef5', '#dfe7ff'],
  ['#16a37a', '#d8f3e8'],
  ['#e8820c', '#ffe9d2'],
  ['#a24bc7', '#f3e0ff'],
  ['#1a8fb8', '#d9f1fb'],
  ['#e0486b', '#ffdfe5'],
  ['#7a9a1a', '#eaf3cc'],
];
const TICK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const HISTORY_WEEKS = 8;

let weekStart = mondayOf(new Date());
let selected = iso(new Date());
const TABS = ['dashboard', 'control', 'diet', 'gym', 'overall'];
let tab = 'dashboard';
let view = 'weekly';
let habits = [];
let done = new Set(); // "habitId|YYYY-MM-DD"

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const weekDates = (start = weekStart) => DAYS.map((_, i) => addDays(start, i));

// In the Android app the page is served from the device, so the API lives on another host.
// 10.0.2.2 is the emulator's alias for the dev machine; on a real phone set the Mac's LAN IP.
const isNative = !!window.Capacitor?.isNativePlatform?.();
// Priority: URL set in the app's Server button, then config.js, then the emulator/dev default.
const apiBase = () =>
  localStorage.getItem('apiBase') || window.APP_CONFIG?.apiUrl || (isNative ? 'http://10.0.2.2:3000' : '');

async function api(url, opts = {}) {
  const res = await fetch(apiBase() + url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.status === 204 ? null : res.json();
}

async function load() {
  const dates = weekDates().map(iso);
  if (!dates.includes(selected)) {
    const t = iso(new Date());
    selected = dates.includes(t) ? t : dates[0];
  }
  // Pull enough history for the overall charts (8 weeks ending at the selected week).
  const from = iso(addDays(weekStart, -7 * (HISTORY_WEEKS - 1)));
  let h, logs;
  try {
    [h, logs] = await Promise.all([api('/api/habits'), api(`/api/logs?from=${from}&to=${dates[6]}`)]);
  } catch (e) {
    console.error(e);
    showError("Can't reach the server.");
    return;
  }
  showError(null);
  habits = h;
  done = new Set(logs.map((l) => `${l.habit}|${l.date}`));
  await loadGym();
  render();
}

function showError(msg) {
  const n = $('notice');
  n.hidden = !msg;
  n.textContent = msg || '';
  if (msg && isNative) {
    const b = el('button');
    b.textContent = `Server: ${apiBase()} — tap to change`;
    b.onclick = changeServer;
    n.append(b);
  }
}

function changeServer() {
  const v = prompt('Server URL', apiBase());
  if (v) {
    localStorage.setItem('apiBase', v.trim().replace(/\/+$/, ''));
    load();
  }
}

const el = (tag, cls) => Object.assign(document.createElement(tag), cls ? { className: cls } : {});
const color = (i) => COLORS[i % COLORS.length];
const isDone = (h, date) => done.has(`${h._id}|${date}`);
const dayPct = (date) =>
  habits.length ? Math.round((habits.filter((h) => isDone(h, date)).length / habits.length) * 100) : 0;
const countIn = (h, dates) => dates.filter((d) => isDone(h, d)).length;
const fmt = (d, o) => d.toLocaleDateString(undefined, o);
const short = (d) => fmt(d, { month: 'short', day: 'numeric' });

// Percent of a full 7-day week, so a fresh week starts at 0 and fills as you go.
function weekPct(start) {
  const dates = weekDates(start).map(iso);
  const total = habits.reduce((n, h) => n + countIn(h, dates), 0);
  return habits.length ? Math.round((total / (habits.length * 7)) * 100) : 0;
}

function render() {
  const dates = weekDates();
  const todayIso = iso(new Date());

  for (const t of TABS) $('tab-' + t).hidden = t !== tab;
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  positionGlide();
  $('weeknav').hidden = tab === 'control' || tab === 'diet' || tab === 'gym';
  $('title').textContent =
    tab === 'control' ? 'Control' : tab === 'diet' ? 'Diet' : tab === 'gym' ? 'Gym' : tab === 'overall' ? 'Overall' : selected === todayIso ? 'Today' : fmt(new Date(selected + 'T00:00'), { weekday: 'long' });

  if (tab === 'dashboard') {
    renderStrip(dates, todayIso);
    renderHero();
    renderList(todayIso);
  } else if (tab === 'control') {
    renderControl();
  } else if (tab === 'gym') {
    renderGym();
  } else if (tab === 'diet') {
    loadDiet();
  } else {
    renderOverall(dates, todayIso);
  }
}

/* ---------- Dashboard ---------- */

function renderStrip(dates, todayIso) {
  const strip = $('strip');
  strip.innerHTML = '';
  dates.forEach((d, i) => {
    const date = iso(d);
    const b = el('button', ['day', date === selected && 'sel', date === todayIso && 'today', date > todayIso && 'future'].filter(Boolean).join(' '));
    b.innerHTML = `<small>${DAYS[i]}</small><b>${d.getDate()}</b><i>${date > todayIso ? '' : dayPct(date) + '%'}</i>`;
    b.onclick = () => {
      selected = date;
      render();
    };
    strip.append(b);
  });
}

function renderHero() {
  const n = habits.filter((h) => isDone(h, selected)).length;
  const pct = dayPct(selected);
  $('heroLabel').textContent = fmt(new Date(selected + 'T00:00'), { weekday: 'long', month: 'long', day: 'numeric' });
  $('heroPct').textContent = pct;
  const locked = selected < iso(new Date()) ? ' · locked' : '';
  $('heroSub').textContent = habits.length ? `${n} of ${habits.length} habits done${locked}` : 'No habits yet';
  $('heroBar').style.width = pct + '%';
}

function renderList(todayIso) {
  const list = $('list');
  list.innerHTML = '';
  const dates = weekDates().map(iso);

  if (!habits.length) {
    list.append(Object.assign(el('div', 'empty'), { textContent: 'No habits yet. Add one in the Control tab.' }));
    return;
  }

  habits.forEach((h, i) => {
    const on = isDone(h, selected);
    const row = el('button', 'row' + (on ? ' done' : '') + (selected < todayIso ? ' past' : ''));
    row.style.setProperty('--c', color(i)[0]);
    row.disabled = selected !== todayIso; // only today can be checked in or out
    const dots = dates.map((d) => `<i class="${[isDone(h, d) && 'on', d === selected && 'sel'].filter(Boolean).join(' ')}"></i>`).join('');
    row.innerHTML = `<span class="tick">${TICK}</span><span class="info"><span class="name"></span><span class="dots">${dots}</span></span><span class="count">${countIn(h, dates)}/7</span>`;
    row.querySelector('.name').textContent = h.name;
    row.onclick = () => toggle(h._id, selected, !on);
    const wrap = el('div', 'row-wrap');
    wrap.append(row);
    list.append(wrap);
  });
}

async function toggle(habit, date, checked) {
  if (date !== iso(new Date())) return; // past and future days are locked
  const key = `${habit}|${date}`;
  checked ? done.add(key) : done.delete(key);
  render();
  try {
    await api('/api/logs', { method: 'PUT', body: { habit, date, done: checked } });
  } catch (e) {
    console.error(e);
    load(); // resync with the server if the save failed
  }
}

/* ---------- Control ---------- */

function renderControl() {
  const box = $('manage');
  box.innerHTML = '';
  if (!habits.length) box.append(Object.assign(el('div', 'empty'), { textContent: 'No habits yet. Add your first one above.' }));
  habits.forEach((h, i) => {
    const row = el('div', 'crow');
    row.style.setProperty('--c', color(i)[0]);
    row.innerHTML = '<span class="sw"></span><span class="name"></span><button class="rm">Remove</button>';
    row.querySelector('.name').textContent = h.name;
    row.querySelector('.rm').onclick = () => removeHabit(h, row);
    box.append(row);
  });
}

async function removeHabit(h, row) {
  if (!confirm(`Remove "${h.name}" and its history?`)) return;
  row.style.height = row.offsetHeight + 'px';
  void row.offsetHeight; // commit the explicit height so it can transition to 0
  row.classList.add('leaving');
  try {
    await Promise.all([api(`/api/habits/${h._id}`, { method: 'DELETE' }), new Promise((r) => setTimeout(r, 280))]);
  } catch (e) {
    console.error(e);
    row.classList.remove('leaving');
    row.style.height = '';
    showError("Couldn't remove the habit — server not reachable.");
    return;
  }
  load();
}

$('add').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!name) return;
  try {
    await api('/api/habits', { method: 'POST', body: { name } });
  } catch (err) {
    console.error(err);
    showError("Couldn't add the habit — server not reachable.");
    return;
  }
  $('name').value = '';
  await load();
  $('manage').lastElementChild?.classList.add('enter');
};

/* ---------- Diet ---------- */

const DIET_INTRO = 'Hey, I\'m your diet planner! I\'m here to help you track your calories and protein. Tell me what you ate, e.g. "2 eggs and a slice of toast", or ask what to eat next.';
let dietLoaded = false;
let dietBusy = false;

function addBubble(role, text) {
  const chat = $('chat');
  chat.querySelector('.empty')?.remove();
  const b = el('div', 'msg ' + (role === 'user' ? 'me' : 'ai'));
  b.textContent = text;
  chat.append(b);
  chat.scrollTop = chat.scrollHeight;
  return b;
}

async function loadDiet() {
  if (dietLoaded) return;
  try {
    const msgs = await api('/api/diet');
    dietLoaded = true;
    const chat = $('chat');
    chat.innerHTML = '';
    if (!msgs.length) addBubble('model', DIET_INTRO);
    msgs.forEach((m) => addBubble(m.role, m.text));
  } catch (e) {
    console.error(e);
    showError("Can't load the diet chat — server not reachable.");
  }
}

$('dietForm').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('dietText').value.trim();
  if (!text || dietBusy) return;
  dietBusy = true;
  $('dietSend').disabled = true;
  $('dietText').value = '';
  addBubble('user', text);
  const typing = addBubble('model', '');
  typing.classList.add('typing');
  typing.innerHTML = '<i></i><i></i><i></i>';
  try {
    const { model } = await api('/api/diet', { method: 'POST', body: { text, date: iso(new Date()) } });
    typing.classList.remove('typing');
    typing.textContent = model.text;
  } catch (err) {
    console.error(err);
    typing.remove();
    $('dietText').value = text;
    showError("Couldn't get a reply — check the server and GEMINI_API_KEY.");
  }
  $('chat').scrollTop = $('chat').scrollHeight;
  dietBusy = false;
  $('dietSend').disabled = false;
};

$('dietClear').onclick = async () => {
  if (dietBusy || !confirm('Clear the whole diet chat and start fresh?')) return;
  dietBusy = true;
  $('dietClear').disabled = true;
  try {
    await api('/api/diet', { method: 'DELETE' });
    const chat = $('chat');
    chat.classList.add('clearing');
    await new Promise((r) => setTimeout(r, 260));
    chat.classList.remove('clearing');
    chat.innerHTML = '';
    addBubble('model', DIET_INTRO);
  } catch (err) {
    console.error(err);
    showError("Couldn't clear the chat — server not reachable.");
  }
  dietBusy = false;
  $('dietClear').disabled = false;
};

/* ---------- Overall ---------- */

function bars(items, compact) {
  const chart = $('chart');
  chart.className = 'chart' + (compact ? ' compact' : '');
  chart.innerHTML = '';
  items.forEach((it) => {
    const col = el('div', 'col' + (it.sel ? ' sel' : ''));
    col.innerHTML = `<div class="t"><i style="height:${it.pct}%"></i></div><small>${it.label}</small><em>${it.pct}%</em>`;
    chart.append(col);
  });
}

function renderOverall(dates, todayIso) {
  $('seg-weekly').classList.toggle('on', view === 'weekly');
  $('seg-daily').classList.toggle('on', view === 'daily');
  const detail = $('detail');
  detail.innerHTML = '';
  const dateStrs = dates.map(iso);

  if (view === 'weekly') {
    const pct = weekPct(weekStart);
    const total = habits.reduce((n, h) => n + countIn(h, dateStrs), 0);
    $('ovLabel').textContent = `Week of ${short(dates[0])}`;
    $('ovSub').textContent = `${total} of ${habits.length * 7} check-ins`;
    $('ovPct').textContent = pct;
    $('ovBar').style.width = pct + '%';

    $('chartTitle').textContent = `Last ${HISTORY_WEEKS} weeks`;
    $('chartHint').textContent = 'Each bar is one week. Taller bar means more habits done.';
    bars(
      Array.from({ length: HISTORY_WEEKS }, (_, k) => {
        const start = addDays(weekStart, -7 * (HISTORY_WEEKS - 1 - k));
        return { pct: weekPct(start), label: k === HISTORY_WEEKS - 1 ? 'This\nweek' : fmt(start, { month: 'short' }) + '\n' + start.getDate(), sel: k === HISTORY_WEEKS - 1 };
      }),
      false
    );

    $('detailTitle').textContent = 'By habit this week';
    habits.forEach((h, i) => {
      const p = Math.round((countIn(h, dateStrs) / 7) * 100);
      const row = el('div', 'wrow');
      row.style.setProperty('--c', color(i)[0]);
      row.innerHTML = `<span class="n"></span><span class="b"><i style="width:${p}%"></i></span><span class="p">${p}%</span>`;
      row.querySelector('.n').textContent = h.name;
      detail.append(row);
    });
  } else {
    // Daily average over the days of this week that have already happened.
    const elapsed = dateStrs.filter((d) => d <= todayIso);
    const avg = elapsed.length ? Math.round(elapsed.reduce((n, d) => n + dayPct(d), 0) / elapsed.length) : 0;
    $('ovLabel').textContent = 'Daily average';
    $('ovSub').textContent = elapsed.length ? `over ${elapsed.length} day${elapsed.length === 1 ? '' : 's'} this week` : 'week not started';
    $('ovPct').textContent = avg;
    $('ovBar').style.width = avg + '%';

    // 14 days ending today (or the last day of the viewed week if it is in the past).
    const end = dateStrs[6] < todayIso ? dates[6] : new Date(todayIso + 'T00:00');
    $('chartTitle').textContent = 'Last 14 days';
    $('chartHint').textContent = 'Each bar is one day. Dark bar is today.';
    bars(
      Array.from({ length: 14 }, (_, k) => {
        const d = addDays(end, -(13 - k));
        const date = iso(d);
        return { pct: dayPct(date), label: d.getDate(), sel: date === todayIso };
      }),
      true
    );

    $('detailTitle').textContent = 'This week, day by day';
    const head = el('div', 'mrow head');
    head.append(el('span'));
    DAYS.forEach((d) => head.append(Object.assign(el('span', 'h'), { textContent: d[0] })));
    head.append(el('span'));
    detail.append(head);
    habits.forEach((h, i) => {
      const row = el('div', 'mrow');
      row.style.setProperty('--c', color(i)[0]);
      row.append(Object.assign(el('span', 'n'), { textContent: h.name }));
      dateStrs.forEach((d) => row.append(el('span', 'dot' + (isDone(h, d) ? ' on' : ''))));
      row.append(Object.assign(el('span', 'p'), { textContent: Math.round((countIn(h, dateStrs) / 7) * 100) + '%' }));
      detail.append(row);
    });
    if (habits.length) {
      const foot = el('div', 'mrow foot');
      foot.append(Object.assign(el('span', 'n'), { textContent: 'Daily' }));
      dateStrs.forEach((d) => foot.append(Object.assign(el('span', 'd'), { textContent: d > todayIso ? '–' : dayPct(d) + '%' })));
      foot.append(el('span'));
      detail.append(foot);
    }
  }
  if (!habits.length) detail.append(Object.assign(el('div', 'empty'), { textContent: 'No habits yet. Add one in the Control tab.' }));
}

/* ---------- Gym ---------- */

const MUSCLES = ['chest', 'biceps', 'triceps', 'back', 'shoulders', 'legs', 'arms'];
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MAX_EXERCISES = 10;
const todayIdx = () => (new Date().getDay() + 6) % 7; // Monday = 0

let gymPlan = {}; // weekday index -> [{ muscle, exercises: [{ name, sets, reps }] }]
let gymLogs = new Map(); // "date|muscle|exercise|set" -> reps done
let gymDay = todayIdx(); // weekday shown
let gymEditing = null; // null, or the form's working copy { day, muscles }

const gymWeek = () => weekDates(mondayOf(new Date())).map(iso);
const gymKey = (date, muscle, exercise, set) => `${date}|${muscle}|${exercise}|${set}`;
const newExercise = () => ({ name: '', sets: 3, reps: 10 });

// Planned and done reps for one weekday; done is capped per set so extra reps cannot push past 100%.
function gymDayStats(idx) {
  const date = gymWeek()[idx];
  let planned = 0, got = 0;
  for (const m of gymPlan[idx] || []) {
    for (const e of m.exercises) {
      for (let s = 0; s < e.sets; s++) {
        planned += e.reps;
        got += Math.min(gymLogs.get(gymKey(date, m.muscle, e.name, s)) || 0, e.reps);
      }
    }
  }
  return { planned, got, pct: planned ? Math.round((got / planned) * 100) : 0 };
}

async function loadGym() {
  const week = gymWeek();
  try {
    const [plans, logs] = await Promise.all([api('/api/gym/plan'), api(`/api/gym/logs?from=${week[0]}&to=${week[6]}`)]);
    gymPlan = Object.fromEntries(plans.map((p) => [p.day, p.muscles]));
    gymLogs = new Map(logs.map((l) => [gymKey(l.date, l.muscle, l.exercise, l.set), l.reps]));
  } catch (e) {
    console.error(e);
  }
}

function renderGym() {
  const planned = Object.keys(gymPlan).length > 0;
  $('gymEmpty').hidden = planned || !!gymEditing;
  $('gymForm').hidden = !gymEditing;
  for (const id of ['gymHero', 'gymStrip', 'gymDay']) $(id).hidden = !planned || !!gymEditing;
  if (gymEditing) return renderGymForm();
  if (!planned) return;

  const stats = DAYS.map((_, i) => gymDayStats(i));
  const planned_ = stats.reduce((n, x) => n + x.planned, 0);
  const got = stats.reduce((n, x) => n + x.got, 0);
  const pct = planned_ ? Math.round((got / planned_) * 100) : 0;
  $('gymHeroPct').textContent = pct;
  $('gymHeroBar').style.width = pct + '%';
  $('gymHeroSub').textContent = `${got} of ${planned_} reps done`;

  const week = gymWeek();
  const todayI = todayIdx();
  const strip = $('gymStrip');
  strip.innerHTML = '';
  DAYS.forEach((name, i) => {
    const b = el('button', ['day', i === gymDay && 'sel', i === todayI && 'today', i > todayI && 'future'].filter(Boolean).join(' '));
    const label = !gymPlan[i] ? '–' : i > todayI ? '' : stats[i].pct + '%';
    b.innerHTML = `<small>${name}</small><b>${new Date(week[i] + 'T00:00').getDate()}</b><i>${label}</i>`;
    b.onclick = () => {
      gymDay = i;
      renderGym();
    };
    strip.append(b);
  });
  renderGymDay(week[gymDay], stats[gymDay]);
}

function renderGymDay(date, st) {
  const box = $('gymDay');
  box.innerHTML = '';
  const muscles = gymPlan[gymDay];
  const head = el('div', 'gym-head');
  head.innerHTML = `<div><h2>${FULL_DAYS[gymDay]}</h2><p class="sub"></p></div><button type="button" class="gym-edit">${muscles ? 'Edit' : 'Add'}</button>`;
  head.querySelector('.sub').textContent = muscles
    ? `${muscles.map((m) => m.muscle).join(' + ')} · ${st.pct}% done${date < iso(new Date()) ? ' · locked' : ''}`
    : 'Rest day';
  head.querySelector('.gym-edit').onclick = () => openGymForm(gymDay);
  box.append(head);
  if (!muscles) return;

  const editable = date === iso(new Date()); // only today can be ticked, like habits
  for (const m of muscles) {
    const block = el('div', 'gym-muscle');
    const title = el('h3');
    title.textContent = m.muscle;
    block.append(title);
    for (const e of m.exercises) {
      const ex = el('div', 'gym-ex');
      const sets = [];
      let doneSets = 0;
      for (let s = 0; s < e.sets; s++) {
        const reps = gymLogs.get(gymKey(date, m.muscle, e.name, s)) || 0;
        if (reps) doneSets++;
        const row = el('div', 'gset' + (reps ? ' done' : ''));
        row.innerHTML = `<button type="button" class="tick" aria-label="Set ${s + 1} done">${TICK}</button><span class="nm">Set ${s + 1}</span><input type="number" inputmode="numeric" min="0" max="100" aria-label="Reps done"><span class="of">/ ${e.reps}</span>`;
        const tick = row.querySelector('button');
        const input = row.querySelector('input');
        input.value = reps || '';
        input.placeholder = '0';
        tick.disabled = input.disabled = !editable;
        tick.onclick = () => saveGymSet(date, m.muscle, e.name, s, reps ? 0 : e.reps);
        input.onchange = () => saveGymSet(date, m.muscle, e.name, s, Math.max(0, Math.min(100, Math.round(Number(input.value)) || 0)));
        sets.push(row);
      }
      ex.innerHTML = '<h4><span></span><small></small></h4>';
      ex.querySelector('span').textContent = e.name;
      ex.querySelector('small').textContent = `${doneSets}/${e.sets} sets · ${e.reps} reps`;
      ex.append(...sets);
      block.append(ex);
    }
    box.append(block);
  }
}

async function saveGymSet(date, muscle, exercise, set, reps) {
  if (date !== iso(new Date())) return;
  const key = gymKey(date, muscle, exercise, set);
  reps ? gymLogs.set(key, reps) : gymLogs.delete(key);
  renderGym();
  try {
    await api('/api/gym/logs', { method: 'PUT', body: { date, muscle, exercise, set, reps } });
  } catch (e) {
    console.error(e);
    await loadGym(); // resync with the server if the save failed
    renderGym();
  }
}

function openGymForm(day) {
  const cur = gymPlan[day];
  gymEditing = {
    day,
    muscles: cur
      ? cur.map((m) => ({ muscle: m.muscle, exercises: m.exercises.map((e) => ({ ...e })) }))
      : [{ muscle: 'chest', exercises: [newExercise()] }],
  };
  renderGym();
}

function renderGymForm() {
  const f = $('gymForm');
  const w = gymEditing;
  const num = (v, max) => Math.min(max, Math.max(1, Math.round(Number(v)) || 1));
  f.innerHTML = '';

  const day = el('label');
  day.innerHTML = `Day<select>${FULL_DAYS.map((n, i) => `<option value="${i}"${i === w.day ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  day.querySelector('select').onchange = (e) => {
    const d = Number(e.target.value);
    const cur = gymPlan[d];
    w.day = d;
    if (cur) w.muscles = cur.map((m) => ({ muscle: m.muscle, exercises: m.exercises.map((x) => ({ ...x })) }));
    renderGymForm();
  };

  const seg = el('div', 'seg');
  seg.innerHTML = `<button type="button" class="${w.muscles.length === 1 ? 'on' : ''}">1 muscle</button><button type="button" class="${w.muscles.length === 2 ? 'on' : ''}">2 muscles</button>`;
  seg.children[0].onclick = () => {
    w.muscles = w.muscles.slice(0, 1);
    renderGymForm();
  };
  seg.children[1].onclick = () => {
    if (w.muscles.length < 2) w.muscles.push({ muscle: MUSCLES.find((m) => m !== w.muscles[0].muscle), exercises: [newExercise()] });
    renderGymForm();
  };
  f.append(day, seg);

  w.muscles.forEach((m, i) => {
    const taken = w.muscles.filter((_, j) => j !== i).map((x) => x.muscle);
    const block = el('div', 'gym-fm');
    block.innerHTML = `<label>Muscle<select>${MUSCLES.map((n) => `<option value="${n}"${n === m.muscle ? ' selected' : ''}${taken.includes(n) ? ' disabled' : ''}>${n}</option>`).join('')}</select></label>
      <div class="xhead"><span>Exercise</span><span>Sets</span><span>Reps</span><span></span></div>`;
    block.querySelector('select').onchange = (e) => (m.muscle = e.target.value);
    m.exercises.forEach((x, j) => {
      const row = el('div', 'xrow');
      row.innerHTML = `<input type="text" maxlength="40" placeholder="e.g. Bench press" autocomplete="off" aria-label="Exercise name">
        <input type="number" inputmode="numeric" min="1" max="20" aria-label="Sets">
        <input type="number" inputmode="numeric" min="1" max="100" aria-label="Reps">
        <button type="button" class="xrm" aria-label="Remove exercise">×</button>`;
      const [name, sets, reps] = row.querySelectorAll('input');
      name.value = x.name;
      sets.value = x.sets;
      reps.value = x.reps;
      name.oninput = () => (x.name = name.value);
      sets.onchange = () => (x.sets = num(sets.value, 20));
      reps.onchange = () => (x.reps = num(reps.value, 100));
      const rm = row.querySelector('.xrm');
      rm.disabled = m.exercises.length === 1;
      rm.onclick = () => {
        m.exercises.splice(j, 1);
        renderGymForm();
      };
      block.append(row);
    });
    const add = el('button', 'gym-btn ghost add-ex');
    add.type = 'button';
    add.textContent = '+ Add exercise';
    add.hidden = m.exercises.length >= MAX_EXERCISES;
    add.onclick = () => {
      m.exercises.push(newExercise());
      renderGymForm();
    };
    block.append(add);
    f.append(block);
  });

  const acts = el('div', 'acts');
  acts.innerHTML = '<button type="submit" class="gym-btn">Save</button><button type="button" class="gym-btn ghost">Cancel</button>';
  if (gymPlan[w.day]) {
    const del = el('button', 'gym-btn danger');
    del.type = 'button';
    del.textContent = 'Remove';
    del.onclick = removeGymDay;
    acts.append(del);
  }
  acts.querySelector('.ghost').onclick = () => {
    gymEditing = null;
    renderGym();
  };
  f.append(acts);
}

$('gymForm').onsubmit = async (e) => {
  e.preventDefault();
  const w = gymEditing;
  const muscles = w.muscles.map((m) => ({ muscle: m.muscle, exercises: m.exercises.map((x) => ({ ...x, name: x.name.trim() })) }));
  const names = (m) => m.exercises.map((x) => x.name.toLowerCase());
  const problem = muscles.find((m) => m.exercises.some((x) => !x.name))
    ? 'Give every exercise a name.'
    : muscles.find((m) => new Set(names(m)).size !== m.exercises.length)
      ? 'Each exercise name must be different within a muscle.'
      : '';
  if (problem) return showError(problem);
  const btn = $('gymForm').querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await api(`/api/gym/plan/${w.day}`, { method: 'PUT', body: { muscles } });
    gymPlan[w.day] = muscles;
    gymDay = w.day;
    gymEditing = null;
  } catch (err) {
    console.error(err);
    showError("Couldn't save the workout — server not reachable.");
    btn.disabled = false;
    return;
  }
  showError(null);
  renderGym();
};

async function removeGymDay() {
  const d = gymEditing.day;
  if (!confirm(`Remove the ${FULL_DAYS[d]} workout?`)) return;
  try {
    await api(`/api/gym/plan/${d}`, { method: 'DELETE' });
    delete gymPlan[d];
    gymEditing = null;
  } catch (err) {
    console.error(err);
    showError("Couldn't remove the workout — server not reachable.");
    return;
  }
  renderGym();
}

$('gymFirst').onclick = () => openGymForm(gymDay);

/* ---------- Wiring ---------- */


// Replay the entrance animation on the visible tab: slide in from the side we came from.
function animateTab(dx) {
  const pane = $('tab-' + tab);
  pane.classList.remove('enter');
  pane.style.setProperty('--dx', dx + 'px');
  [...pane.children].forEach((c, i) => c.style.setProperty('--i', i));
  void pane.offsetWidth; // restart the animation
  pane.classList.add('enter');
  clearTimeout(animateTab.t);
  animateTab.t = setTimeout(() => pane.classList.remove('enter'), 900);
}

function positionGlide() {
  const b = document.querySelector('#tabbar button.on');
  const g = $('glide');
  if (!b) return;
  g.style.width = b.offsetWidth + 'px';
  g.style.transform = `translateX(${b.offsetLeft}px)`;
  requestAnimationFrame(() => g.classList.add('ready')); // no slide on first paint
}

document.querySelectorAll('#tabbar button').forEach((b) => {
  b.onclick = () => {
    const next = b.dataset.tab;
    if (next === tab) return;
    const dx = (TABS.indexOf(next) - TABS.indexOf(tab)) * 28;
    tab = next;
    document.querySelector('.app').scrollTop = 0;
    render();
    animateTab(dx);
  };
});
$('seg-weekly').onclick = () => {
  if (view === 'weekly') return;
  view = 'weekly';
  render();
  animateTab(-20);
};
$('seg-daily').onclick = () => {
  if (view === 'daily') return;
  view = 'daily';
  render();
  animateTab(20);
};
window.addEventListener('resize', positionGlide);

const shift = (days) => {
  weekStart = addDays(weekStart, days);
  load();
};
$('prev').onclick = () => shift(-7);
$('next').onclick = () => shift(7);
$('today').onclick = () => {
  weekStart = mondayOf(new Date());
  selected = iso(new Date());
  load();
};

if (isNative) {
  $('server').hidden = false;
  $('server').onclick = changeServer;
}

load();

// Opening animation: comet falls from the sky into the logo, greeting rains in. Tap to skip.
(() => {
  const splash = $('splash');
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  splash.style.setProperty('--horizon', hour < 5 || hour >= 20 ? '#1b2a6b' : hour < 12 ? '#1f6f7a' : hour < 17 ? '#16508f' : '#7a3b5e');
  $('greet').innerHTML = [...greeting].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('');
  $('sky').innerHTML = Array.from({ length: 45 }, () => {
    const s = 1 + Math.random() * 2.5;
    return `<i class="star" style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${s}px;height:${s}px;--o:${0.4 + Math.random() * 0.6};--d:${1.5 + Math.random() * 2}s;--t:${Math.random() * 1.2}s"></i>`;
  }).join('');
  const colors = ['#ffd27a', '#7fd9b6', '#ffffff', '#5fb7ff'];
  $('sparks').innerHTML = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2, r = 90 + Math.random() * 90;
    return `<i class="spark" style="--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px;--c:${colors[i % 4]}"></i>`;
  }).join('');
  const hide = () => {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 800);
  };
  splash.onclick = hide;
  setTimeout(hide, 4300);
})();

/* ---------- Push reminder (Android only) ---------- */

(() => {
  const Push = window.Capacitor?.Plugins?.PushNotifications;
  if (!Push || window.Capacitor.getPlatform() !== 'android') return; // no plugin in a plain browser
  $('remind').hidden = false;
  $('tab-control').classList.add('has-remind');

  const KEY = 'reminder';
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  const state = { on: !!saved.on, every: saved.every || 3, token: saved.token || '' };
  const persist = () => localStorage.setItem(KEY, JSON.stringify(state));
  const paint = () => {
    $('remindOn').setAttribute('aria-checked', state.on);
    $('remindEvery').value = state.every;
    $('remindEvery').disabled = !state.on;
  };
  const sync = () =>
    state.token &&
    api('/api/push', { method: 'PUT', body: { token: state.token, enabled: state.on, everyHours: state.every, tzOffset: new Date().getTimezoneOffset() } }).catch((e) => {
      console.error(e);
      showError("Couldn't save the reminder — server not reachable.");
    });

  Push.addListener('registration', (t) => {
    state.token = t.value;
    persist();
    sync();
  });
  Push.addListener('registrationError', (e) => {
    console.error(e);
    state.on = false;
    persist();
    paint();
    showError("Couldn't set up push — is google-services.json in the app?");
  });

  async function enable() {
    let perm = await Push.checkPermissions();
    if (perm.receive !== 'granted') perm = await Push.requestPermissions();
    if (perm.receive !== 'granted') {
      showError('Allow notifications for Habits in Android settings.');
      return false;
    }
    await Push.register(); // fires 'registration' with the FCM token, which syncs to the server
    return true;
  }

  $('remindOn').onclick = async () => {
    const next = !state.on;
    if (next && !(await enable())) return;
    state.on = next;
    persist();
    paint();
    sync();
  };
  $('remindEvery').onchange = (e) => {
    state.every = Number(e.target.value) || 3;
    persist();
    paint();
    sync();
  };

  paint();
  if (state.on) Push.register(); // refresh token on launch in case it rotated
})();
