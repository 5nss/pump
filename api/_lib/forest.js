// Random forest inference, a JavaScript twin of run_forest() in backend/train.py.
const model = require('./model.json');

function walk(tree, x) {
  let n = 0;
  while (tree.l[n] !== -1) {
    n = x[tree.f[n]] <= tree.t[n] ? tree.l[n] : tree.r[n];
  }
  return tree.v[n];
}

function mean(trees, x) {
  let s = 0;
  for (const t of trees) s += walk(t, x);
  return s / trees.length;
}

const FEATURES = model.features;

// scikit-learn casts inputs to float32 before comparing with thresholds; do the same.
function predict(reading) {
  const x = FEATURES.map((f) => Math.fround(reading[f]));
  const risk = mean(model.clf, x);
  const rul = Math.max(0, mean(model.reg, x));
  return { risk, rul };
}

module.exports = { predict, FEATURES };
