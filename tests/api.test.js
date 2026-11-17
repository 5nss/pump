// Run with:  node tests/api.test.js
// Checks the JavaScript API against predictions from the Python training code.
const assert = require('assert');
const predict = require('../api/predict');
const health = require('../api/health');
const metricsApi = require('../api/metrics');
const fixtures = require('./fixtures.json');

function call(handler, req) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b || '{}') }); } };
    handler(req, res);
  });
}

(async () => {
  let worstRul = 0, worstRisk = 0;
  for (const fx of fixtures) {
    const r = await call(predict, { method: 'GET', query: fx.input });
    assert.strictEqual(r.status, 200);
    worstRul = Math.max(worstRul, Math.abs(r.body.rul_hours - fx.rul));
    worstRisk = Math.max(worstRisk, Math.abs(r.body.failure_risk - fx.risk));
  }
  assert.ok(worstRul < 0.2, 'RUL differs from Python by ' + worstRul);
  assert.ok(worstRisk < 0.002, 'risk differs from Python by ' + worstRisk);
  console.log(`parity ok on ${fixtures.length} readings (max RUL diff ${worstRul.toFixed(3)} h, max risk diff ${worstRisk.toFixed(4)})`);

  const fresh = await call(predict, { method: 'POST', body: { vibration: 0.35, pressure: 104, temperature: 64, flow_rate: 33 } });
  const worn = await call(predict, { method: 'POST', body: { vibration: 2.6, pressure: 80, temperature: 87, flow_rate: 24.5 } });
  assert.strictEqual(fresh.body.status, 'healthy');
  assert.strictEqual(worn.body.status, 'critical');
  assert.ok(fresh.body.rul_hours > worn.body.rul_hours + 200);
  console.log(`new pump: ${fresh.body.status}, ${fresh.body.rul_hours} h | worn pump: ${worn.body.status}, ${worn.body.rul_hours} h`);

  assert.strictEqual((await call(predict, { method: 'GET', query: { vibration: 'abc' } })).status, 400);
  assert.strictEqual((await call(predict, { method: 'POST', body: { vibration: 1, pressure: 100, temperature: 999, flow_rate: 30 } })).status, 400);
  assert.strictEqual((await call(predict, { method: 'DELETE' })).status, 405);
  assert.strictEqual((await call(health, { method: 'GET' })).body.ok, true);
  assert.ok((await call(metricsApi, { method: 'GET' })).body.regressor.mae_hours > 0);
  console.log('validation, health and metrics ok');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
