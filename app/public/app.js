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
const TABS = ['dashboard', 'control', 'diet', 'overall'];
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
  $('weeknav').hidden = tab === 'control' || tab === 'diet';
  $('range').textContent =
    tab === 'control' ? `${habits.length} habit${habits.length === 1 ? '' : 's'}` : tab === 'diet' ? 'Calories & protein' : `${short(dates[0])} – ${short(dates[6])}`;
  $('title').textContent =
    tab === 'control' ? 'Control' : tab === 'diet' ? 'Diet' : tab === 'overall' ? 'Overall' : selected === todayIso ? 'Today' : fmt(new Date(selected + 'T00:00'), { weekday: 'long' });

  if (tab === 'dashboard') {
    renderStrip(dates, todayIso);
    renderHero();
    renderList(todayIso);
  } else if (tab === 'control') {
    renderControl();
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
    if (!msgs.length) chat.append(Object.assign(el('div', 'empty'), { textContent: 'Tell me what you ate, e.g. "2 eggs and a slice of toast".' }));
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
  const typing = addBubble('model', '…');
  typing.classList.add('typing');
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

// Greeting splash: shows once per launch, tap to skip.
(() => {
  const splash = $('splash');
  const hour = new Date().getHours();
  $('greet').textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const hide = () => {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 700);
  };
  splash.onclick = hide;
  setTimeout(hide, 2400);
})();
