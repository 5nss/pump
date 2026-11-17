// GET  /api/predict?vibration=0.4&pressure=102&temperature=65&flow_rate=33
// POST /api/predict  {"vibration":0.4,"pressure":102,"temperature":65,"flow_rate":33}
const { predict, FEATURES } = require('./_lib/forest');
const metrics = require('./_lib/metrics.json');
const { send } = require('./_lib/http');

const LIMITS = {            // accepted sensor ranges (anything outside is a bad reading)
  vibration: [-5, 10],
  pressure: [0, 300],
  temperature: [-20, 200],
  flow_rate: [0, 100],
};
const RULES = {
  vibration: (v) => v > 1.5,
  pressure: (v) => v < 85,
  temperature: (v) => v > 85,
  flow_rate: (v) => v < 25,
};

function readInput(req) {
  if (req.method === 'POST') {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
    return b && typeof b === 'object' ? b : {};
  }
  return req.query || {};
}

module.exports = (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });

  const started = process.hrtime.bigint();
  const input = readInput(req);
  const reading = {};
  const problems = [];
  for (const f of FEATURES) {
    const raw = input[f];
    const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`${f} is missing or not a number`); continue; }
    const [lo, hi] = LIMITS[f];
    if (v < lo || v > hi) { problems.push(`${f} must be between ${lo} and ${hi}`); continue; }
    reading[f] = v;
  }
  if (problems.length) return send(res, 400, { error: 'Invalid reading', problems });

  const { risk, rul } = predict(reading);
  const alarms = FEATURES.filter((f) => RULES[f](reading[f]));
  const status = rul < metrics.horizon_hours || risk >= 0.5 ? 'critical' : rul < 150 ? 'watch' : 'healthy';

  send(res, 200, {
    status,
    failure_risk: Number(risk.toFixed(3)),
    at_risk: risk >= 0.5,
    rul_hours: Number(rul.toFixed(1)),
    horizon_hours: metrics.horizon_hours,
    rule_alarms: alarms,
    rule_fault: alarms.length > 0,
    reading,
    model_version: metrics.model_version,
    latency_ms: Number(process.hrtime.bigint() - started) / 1e6,
  });
};
