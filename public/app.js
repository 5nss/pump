'use strict';
const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const mono = () => '12px ' + css('--mono');

const SENSORS = [
  { k: 'vibration', name: 'Vibration', unit: 'mm/s', min: 0, max: 3.5, step: 0.05, v: 0.35, rule: '> 1.5', trip: (v) => v > 1.5, dec: 2 },
  { k: 'pressure', name: 'Pressure', unit: 'kPa', min: 70, max: 115, step: 0.5, v: 104, rule: '< 85', trip: (v) => v < 85, dec: 1 },
  { k: 'temperature', name: 'Temperature', unit: '°C', min: 55, max: 95, step: 0.5, v: 64, rule: '> 85', trip: (v) => v > 85, dec: 1 },
  { k: 'flow_rate', name: 'Flow rate', unit: 'lpm', min: 20, max: 38, step: 0.25, v: 33, rule: '< 25', trip: (v) => v < 25, dec: 2 },
];
const PRESETS = {
  new: { vibration: 0.35, pressure: 104, temperature: 64, flow_rate: 33 },
  mid: { vibration: 1.2, pressure: 92, temperature: 74, flow_rate: 29.5 },
  late: { vibration: 2.4, pressure: 80, temperature: 85, flow_rate: 25 },
};
const state = { fleet: [], runs: [], metrics: null, pump: 0, last: null };

/* ---------- tabs ---------- */
const TABS = ['diagnose', 'lifecycle', 'model', 'bench'];
function route() {
  const name = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'diagnose';
  TABS.forEach((t) => { $(t).hidden = t !== name; });
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  drawAll();
}
window.addEventListener('hashchange', route);

/* ---------- backend ---------- */
async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || 'Request failed (' + r.status + ')');
  return body;
}
async function checkBackend() {
  const el = $('backend'), t0 = performance.now();
  try {
    const h = await api('/api/health');
    if (!h.ok) throw new Error('unhealthy');
    el.className = 'backend up';
    $('backendText').textContent = 'Backend online · model ' + h.model_version + ' · ' + Math.round(performance.now() - t0) + ' ms';
  } catch (e) {
    el.className = 'backend down';
    $('backendText').textContent = 'Backend offline';
  }
}

/* ---------- diagnose ---------- */
function buildControls() {
  const box = $('controls');
  SENSORS.forEach((s) => {
    box.insertAdjacentHTML('beforeend',
      `<div class="ctl" id="c_${s.k}"><label for="r_${s.k}"><span>${s.name}</span><span class="rule">rule alarm if ${s.rule}</span><span class="val" id="v_${s.k}"></span></label>` +
      `<input type="range" id="r_${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.v}"></div>`);
    $('r_' + s.k).addEventListener('input', (e) => { s.v = +e.target.value; diagnose(); });
  });
}
function setReading(r) {
  SENSORS.forEach((s) => { s.v = Math.min(s.max, Math.max(s.min, r[s.k])); $('r_' + s.k).value = s.v; });
  diagnose();
}
let timer = null, inflight = 0;
function diagnose() {
  SENSORS.forEach((s) => {
    $('v_' + s.k).textContent = s.v.toFixed(s.dec) + ' ' + s.unit;
    $('c_' + s.k).classList.toggle('tripped', s.trip(s.v));
  });
  drawFleet();
  clearTimeout(timer);
  timer = setTimeout(callPredict, 90);
}
async function callPredict() {
  const id = ++inflight;
  const q = new URLSearchParams(SENSORS.reduce((o, s) => (o[s.k] = s.v, o), {}));
  try {
    const p = await api('/api/predict?' + q);
    if (id !== inflight) return;
    state.last = p;
    renderVerdict(p);
  } catch (e) {
    if (id !== inflight) return;
    $('verdict').className = 'verdict critical';
    $('verdictText').textContent = 'Backend error: ' + e.message;
  }
}
function renderVerdict(p) {
  const label = { healthy: 'Healthy', watch: 'Watch: plan maintenance', critical: 'Critical: service now' }[p.status];
  $('verdict').className = 'verdict ' + p.status;
  $('verdictText').textContent = label;
  $('rulNum').textContent = Math.round(p.rul_hours);
  const days = p.rul_hours / 24;
  $('rulSub').textContent = days >= 1 ? 'About ' + days.toFixed(days < 10 ? 1 : 0) + ' days of running time' : 'Less than a day of running time';
  $('needle').style.left = 'calc(' + Math.min(p.rul_hours, 700) / 700 * 100 + '% - 1.5px)';
  $('hz').textContent = p.horizon_hours;
  $('riskPct').textContent = Math.round(p.failure_risk * 100) + '%';
  $('riskBar').style.width = p.failure_risk * 100 + '%';
  $('riskBar').style.background = p.failure_risk >= 0.5 ? css('--crit') : p.failure_risk >= 0.2 ? css('--watch') : css('--accent');
  $('ruleSays').textContent = p.rule_fault ? 'Alarm: ' + p.rule_alarms.join(', ').replace(/_/g, ' ') : 'No alarm';
  $('mlSays').textContent = p.at_risk ? 'Failure within ' + p.horizon_hours + ' h' : 'Not at risk';
  $('raw').textContent = JSON.stringify(p, null, 2);
}

/* ---------- charts ---------- */
function frame(c, m) {
  const x = c.getContext('2d'), W = c.width, H = c.height;
  x.clearRect(0, 0, W, H);
  x.font = mono(); x.lineWidth = 1;
  return { x, W, H, L: m.l, R: W - m.r, T: m.t, B: H - m.b };
}
function axes(f, xr, yr, xt, yt, xl, yl, fmtX, fmtY) {
  const { x } = f, sx = (v) => f.L + (v - xr[0]) / (xr[1] - xr[0]) * (f.R - f.L), sy = (v) => f.B - (v - yr[0]) / (yr[1] - yr[0]) * (f.B - f.T);
  x.fillStyle = css('--muted'); x.strokeStyle = css('--line');
  xt.forEach((t) => { x.beginPath(); x.moveTo(sx(t), f.T); x.lineTo(sx(t), f.B); x.stroke(); x.textAlign = 'center'; x.fillText(fmtX ? fmtX(t) : t, sx(t), f.B + 16); });
  yt.forEach((t) => { x.beginPath(); x.moveTo(f.L, sy(t)); x.lineTo(f.R, sy(t)); x.stroke(); x.textAlign = 'right'; x.fillText(fmtY ? fmtY(t) : t, f.L - 6, sy(t) + 4); });
  x.textAlign = 'center'; x.fillText(xl, (f.L + f.R) / 2, f.H - 4);
  x.save(); x.translate(12, (f.T + f.B) / 2); x.rotate(-Math.PI / 2); x.fillText(yl, 0, 0); x.restore();
  return { sx, sy };
}
function path(f, pts, sx, sy, color, w) {
  const { x } = f; x.strokeStyle = color; x.lineWidth = w; x.lineJoin = 'round'; x.beginPath();
  pts.forEach(([a, b], i) => (i ? x.lineTo(sx(a), sy(b)) : x.moveTo(sx(a), sy(b)))); x.stroke(); x.lineWidth = 1;
}
function riskColor(r) { return r >= 0.5 ? '#d0422a' : r >= 0.15 ? '#d9a13b' : '#2c8fb0'; }

function drawFleet() {
  const c = $('fleetCanvas'); if (!c || $('diagnose').hidden || !state.fleet.length) return;
  const f = frame(c, { l: 52, r: 14, t: 12, b: 40 });
  const { sx, sy } = axes(f, [55, 95], [0, 3.5], [55, 65, 75, 85, 95], [0, 1, 2, 3], 'Temperature (°C)', 'Vibration (mm/s)');
  const { x } = f;
  [...state.fleet].sort((a, b) => a.risk - b.risk).forEach((d) => {
    x.globalAlpha = 0.65; x.fillStyle = riskColor(d.risk); x.beginPath(); x.arc(sx(d.T), sy(d.v), 3, 0, 7); x.fill();
  });
  x.globalAlpha = 1;
  const t = SENSORS[2].v, v = SENSORS[0].v;
  x.beginPath(); x.arc(sx(t), sy(v), 9, 0, 7); x.fillStyle = css('--panel'); x.fill(); x.lineWidth = 2.5; x.strokeStyle = css('--ink'); x.stroke(); x.lineWidth = 1;
}

function run() { return state.runs[state.pump]; }
function firstIdx(arr, fn) { const i = arr.findIndex(fn); return i < 0 ? null : i; }
function ruleFires(r, i) { return r.vibration[i] > 1.5 || r.pressure[i] < 85 || r.temperature[i] > 85 || r.flow_rate[i] < 25; }

function drawLife() {
  const c = $('rulCanvas'); if (!c || $('lifecycle').hidden || !state.runs.length) return;
  const r = run(), f = frame(c, { l: 52, r: 14, t: 14, b: 40 }), maxT = r.life_hours;
  const top = Math.ceil(maxT / 100) * 100;
  const { sx, sy } = axes(f, [0, maxT], [0, top], range(0, maxT, 100), range(0, top, 100), 'Pump age (hours)', 'Hours of life left');
  const { x } = f;
  x.fillStyle = css('--crit'); x.globalAlpha = 0.15; x.fillRect(sx(maxT - 48), f.T, sx(maxT) - sx(maxT - 48), f.B - f.T); x.globalAlpha = 1;
  path(f, r.t.map((t, i) => [t, r.rul[i]]), sx, sy, css('--ink'), 2);
  path(f, r.t.map((t, i) => [t, r.rul_pred[i]]), sx, sy, css('--accent'), 2);
  const i = +$('scrub').value, px = sx(r.t[i]);
  x.strokeStyle = css('--muted'); x.setLineDash([4, 4]); x.beginPath(); x.moveTo(px, f.T); x.lineTo(px, f.B); x.stroke(); x.setLineDash([]);
  x.fillStyle = css('--accent'); x.beginPath(); x.arc(px, sy(r.rul_pred[i]), 5, 0, 7); x.fill();
}
function range(a, b, s) { const o = []; for (let v = a; v <= b; v += s) o.push(v); return o; }

function drawSensors() {
  const c = $('sensorCanvas'); if (!c || $('lifecycle').hidden || !state.runs.length) return;
  const r = run(), f = frame(c, { l: 44, r: 12, t: 12, b: 40 });
  const { sx, sy } = axes(f, [0, r.life_hours], [0, 1], range(0, r.life_hours, 100), [0, 0.5, 1], 'Pump age (hours)', 'Normalised reading');
  const cols = [css('--crit'), css('--accent'), css('--watch'), css('--ok')];
  const keys = ['vibration', 'pressure', 'temperature', 'flow_rate'];
  keys.forEach((k, j) => {
    const lo = Math.min(...r[k]), hi = Math.max(...r[k]);
    path(f, r.t.map((t, i) => [t, (r[k][i] - lo) / (hi - lo)]), sx, sy, cols[j], 1.6);
  });
  $('sensorLegend').innerHTML = keys.map((k, j) => `<span><i style="background:${cols[j]}"></i>${k.replace('_', ' ')}</span>`).join('');
}

function renderLife() {
  const r = run(), i = +$('scrub').value;
  $('ageOut').textContent = r.t[i] + ' h of ' + r.life_hours + ' h';
  const stat = (k, v) => `<div class="stat"><span class="k">${k}</span><b>${v}</b></div>`;
  $('scrubStats').innerHTML =
    stat('Actual life left', r.rul[i] + ' h') + stat('Model estimate', Math.round(r.rul_pred[i]) + ' h') +
    stat('Failure risk', Math.round(r.risk[i] * 100) + '%') + stat('Rules alarm', ruleFires(r, i) ? 'Yes' : 'No');
  const ri = firstIdx(r.t, (_, k) => ruleFires(r, k)), mi = firstIdx(r.risk, (v) => v >= 0.5);
  const lead = (k) => (k === null ? 'never' : (r.life_hours - r.t[k]) + ' h before failure');
  const rl = ri === null ? 0 : r.life_hours - r.t[ri], ml = mi === null ? 0 : r.life_hours - r.t[mi];
  $('timing').className = 'timing';
  $('timing').innerHTML =
    `<div class="line"><span>Fixed rules first alarm</span><b>${lead(ri)}</b></div>` +
    `<div class="line"><span>Random forest first flags risk</span><b>${lead(mi)}</b></div>` +
    `<div class="line"><span>Failure</span><b>${r.life_hours} h</b></div>` +
    `<p class="verdictline">${rl > 100 && ml < 100
      ? 'The rules go off about ' + (rl - ml) + ' h earlier than the model, long before the pump is close to failing. A crew sent at the first rule alarm would be pulling a pump with weeks of life left.'
      : 'Both methods raised the alarm at similar times for this pump.'}</p>`;
  drawLife();
}

function drawBench() {
  const c = $('benchCanvas'); if (!c || $('bench').hidden) return;
  const f = frame(c, { l: 52, r: 14, t: 14, b: 40 });
  const { sx, sy } = axes(f, [14, 17.5], [18, 34], [14, 15, 16, 17], [18, 22, 26, 30, 34], 'Discharge (lpm)', 'Efficiency (%)');
  BENCH.forEach((r, i) => {
    f.x.fillStyle = css('--accent'); f.x.beginPath(); f.x.arc(sx(r[3]), sy(r[5]), 5, 0, 7); f.x.fill();
    f.x.fillStyle = css('--muted'); f.x.textAlign = 'left'; f.x.fillText(i + 1, sx(r[3]) + 8, sy(r[5]) + 4);
  });
}

/* ---------- model view ---------- */
function renderModel() {
  const m = state.metrics, c = m.classifier.model, b = m.classifier.rules_baseline;
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const card = (k, v, d) => `<div class="card"><span class="k">${k}</span><b>${v}</b><span class="d">${d}</span></div>`;
  $('cards').innerHTML =
    card('Failure accuracy', pct(c.accuracy), 'Rules alone: ' + pct(b.accuracy)) +
    card('Failures caught', pct(c.recall), c.fn + ' missed in ' + (c.tp + c.fn)) +
    card('Alarm precision', pct(c.precision), 'Rules alone: ' + pct(b.precision)) +
    card('Life estimate error', m.regressor.mae_hours + ' h', 'Last 150 h: ' + m.regressor.mae_hours_last_150h + ' h');
  const row = (label, a, r, hi) => {
    const aw = hi ? a > r : a < r, rw = hi ? r > a : r < a;
    return `<tr><td>${label}</td><td class="${aw ? 'win' : ''}">${a}</td><td class="${rw ? 'win' : ''}">${r}</td></tr>`;
  };
  $('cmp').innerHTML = '<tr><th></th><th>Random forest</th><th>Fixed rules</th></tr>' +
    row('Accuracy', pct(c.accuracy), pct(b.accuracy), true) + row('Precision', pct(c.precision), pct(b.precision), true) +
    row('Recall', pct(c.recall), pct(b.recall), true) + row('F1 score', c.f1, b.f1, true) +
    row('False alarms', c.fp, b.fp, false) + row('Missed failures', c.fn, b.fn, false);
  const imp = (title, o) => `<p class="note" style="margin:8px 0 6px"><b>${title}</b></p>` +
    Object.entries(o).sort((a, b2) => b2[1] - a[1]).map(([k, v]) =>
      `<div class="imp"><span>${k.replace('_', ' ')}</span><div class="bar"><div style="width:${v * 100}%"></div></div><b>${Math.round(v * 100)}%</b></div>`).join('');
  $('imp').innerHTML = imp('Failure classifier', m.classifier.importances) + imp('Life estimator', m.regressor.importances);
  const d = m.data;
  $('how').innerHTML = [
    ['1. Simulate', d.pumps + ' pumps run from new to failure, one reading every ' + d.reading_every_hours + ' h. Wear raises vibration and temperature and lowers pressure and flow.'],
    ['2. Split by pump', d.train_pumps + ' pumps train the models; ' + d.test_pumps + ' unseen pumps (' + d.test_rows + ' readings) score them. No pump appears in both.'],
    ['3. Train', 'Two random forests of 30 trees: one answers "failure within ' + m.horizon_hours + ' h?", the other predicts hours of life left.'],
    ['4. Serve', 'The forests are exported to JSON and run inside the /api/predict function, so scores come from the model that answers requests.'],
  ].map(([h, p]) => `<div><h3>${h}</h3><p>${p}</p></div>`).join('');
}

/* ---------- bench ---------- */
const BENCH = [[860,24.01,26.11,14.73,0.288,32.4],[830,25.68,26.66,14.31,0.325,29.5],[800,26.5,25.0,16.89,0.261,26.5],[200,26.66,24.88,16.5,0.26,24.0],[200,29.61,20.44,16.49,0.308,20.4],[200,30.51,19.44,16.35,0.213,20.0],[160,13.81,18.89,15.81,0.238,23.9],[140,13.35,18.01,15.13,0.233,24.4],[40,12.19,17.43,14.49,0.291,20.5]];
function renderBench() {
  $('tbl').innerHTML = '<tr><th>Run</th><th>Suction (mm Hg)</th><th>Discharge head (m)</th><th>Total head (m)</th><th>Flow (lpm)</th><th>Power (kW)</th><th>Efficiency (%)</th></tr>' +
    BENCH.map((r, i) => `<tr><td>${i + 1}</td><td>${r[0]}</td><td>${r[1].toFixed(2)}</td><td>${r[2].toFixed(2)}</td><td>${r[3].toFixed(2)}</td><td>${r[4].toFixed(3)}</td><td>${r[5].toFixed(1)}</td></tr>`).join('');
}

function drawAll() { drawFleet(); drawLife(); drawSensors(); drawBench(); }

/* ---------- boot ---------- */
async function boot() {
  buildControls(); renderBench();
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => setReading(PRESETS[b.dataset.preset])));
  $('rand').addEventListener('click', () => { if (state.fleet.length) { const d = state.fleet[Math.floor(Math.random() * state.fleet.length)]; setReading({ vibration: d.v, pressure: d.p, temperature: d.T, flow_rate: d.q }); } });
  route(); diagnose(); checkBackend();

  const [fleet, runs, metrics] = await Promise.all([
    fetch('data/fleet.json').then((r) => r.json()).catch(() => []),
    fetch('data/runs.json').then((r) => r.json()).catch(() => []),
    api('/api/metrics').catch(() => null),
  ]);
  state.fleet = fleet; state.runs = runs; state.metrics = metrics;
  if (runs.length) {
    $('pumpSel').innerHTML = runs.map((r, i) => `<option value="${i}">${r.pump} (${r.life_hours} h life)</option>`).join('');
    const sync = () => { $('scrub').max = run().t.length - 1; $('scrub').value = Math.floor(run().t.length * 0.55); renderLife(); drawSensors(); };
    $('pumpSel').addEventListener('change', (e) => { state.pump = +e.target.value; sync(); });
    $('scrub').addEventListener('input', renderLife);
    sync();
  }
  if (metrics) renderModel();
  drawAll();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { drawAll(); if (state.last) renderVerdict(state.last); });
boot();
