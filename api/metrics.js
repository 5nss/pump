// GET /api/metrics  held-out test scores for the deployed models
const metrics = require('./_lib/metrics.json');
const { send } = require('./_lib/http');

module.exports = (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  send(res, 200, metrics);
};
