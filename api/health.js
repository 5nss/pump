// GET /api/health  proves the backend is up and the model loads and answers
const { predict } = require('./_lib/forest');
const metrics = require('./_lib/metrics.json');
const { send } = require('./_lib/http');

module.exports = (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const probe = predict({ vibration: 0.35, pressure: 104, temperature: 64, flow_rate: 33 });
  send(res, 200, {
    ok: Number.isFinite(probe.risk) && Number.isFinite(probe.rul),
    model_version: metrics.model_version,
    probe_new_pump_rul_hours: Number(probe.rul.toFixed(1)),
    time: new Date().toISOString(),
  });
};
