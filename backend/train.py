"""Train the Pump Analysis models and export them for the web API.

Pipeline
1. Simulate run-to-failure histories for 60 centrifugal pumps (sensor drift as wear grows).
2. Split BY PUMP (48 train / 12 test) so the test set holds pumps the model never saw.
3. Train two random forests:
   - classifier: will this pump fail within the next 48 hours?
   - regressor:  how many hours of Remaining Useful Life (RUL) are left?
4. Export both forests to JSON so a serverless function can run them without Python.
5. Score the EXPORTED forests (what the API serves) and compare with the fixed-threshold rules.

Run from the repo root:  python backend/train.py
"""
import json
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "api" / "_lib"
DATA = ROOT / "public" / "data"
FEATURES = ["vibration", "pressure", "temperature", "flow_rate"]
HORIZON_H = 48          # "at risk" means failure within this many hours
STEP_H = 2              # one reading every 2 hours
N_PUMPS, N_TEST = 60, 12
SEED = 7

# Same limits as the original project's data_loader.py
RULES = {
    "vibration": (">", 1.5),
    "pressure": ("<", 85.0),
    "temperature": (">", 85.0),
    "flow_rate": ("<", 25.0),
}


def simulate_pump(pid, rng):
    life = int(rng.integers(300, 700))            # hours until failure
    shape = rng.uniform(1.6, 2.8)                  # how late the wear speeds up
    base = dict(
        vibration=rng.normal(0.35, 0.08),
        temperature=rng.normal(64, 2.0),
        pressure=rng.normal(104, 3.0),
        flow_rate=rng.normal(33, 1.0),
    )
    rows = []
    for t in range(0, life + 1, STEP_H):
        h = (t / life) ** shape                    # health index: 0 new, 1 failed
        rows.append((
            pid, t, life - t,
            base["vibration"] + 2.4 * h + rng.normal(0, 0.12),
            base["pressure"] - 26.0 * h + rng.normal(0, 1.5),
            base["temperature"] + 24.0 * h + rng.normal(0, 0.8),
            base["flow_rate"] - 9.0 * h + rng.normal(0, 0.5),
        ))
    return rows


def build_dataset():
    rng = np.random.default_rng(SEED)
    rows = [r for pid in range(N_PUMPS) for r in simulate_pump(pid, rng)]
    arr = np.array(rows, dtype=float)
    return dict(pump=arr[:, 0].astype(int), t=arr[:, 1], rul=arr[:, 2], X=arr[:, 3:7])


def rule_alarm(X):
    out = np.zeros(len(X), dtype=bool)
    for i, f in enumerate(FEATURES):
        op, lim = RULES[f]
        out |= (X[:, i] > lim) if op == ">" else (X[:, i] < lim)
    return out


def export_forest(model, classifier):
    trees = []
    for est in model.estimators_:
        tr = est.tree_
        if classifier:
            v = tr.value[:, 0, :]
            val = v[:, 1] / v.sum(axis=1)
        else:
            val = tr.value[:, 0, 0]
        trees.append(dict(
            l=tr.children_left.tolist(), r=tr.children_right.tolist(),
            f=tr.feature.tolist(),
            t=[round(float(x), 4) for x in tr.threshold],
            v=[round(float(x), 4) for x in val],
        ))
    return trees


def run_forest(trees, X):
    """Python twin of api/_lib/forest.js. Scores what the API will actually serve."""
    X32 = X.astype(np.float32)
    out = np.zeros(len(X))
    for tr in trees:
        l, r, f, t, v = (np.array(tr[k]) for k in "lrftv")
        node = np.zeros(len(X), dtype=int)
        while True:
            internal = l[node] != -1
            if not internal.any():
                break
            go_left = X32[np.arange(len(X)), np.where(internal, f[node], 0)] <= np.float32(1) * t[node]
            node = np.where(internal, np.where(go_left, l[node], r[node]), node)
        out += v[node]
    return out / len(trees)


def prf(y, p):
    tp = int(((y == 1) & (p == 1)).sum()); fp = int(((y == 0) & (p == 1)).sum())
    fn = int(((y == 1) & (p == 0)).sum()); tn = int(((y == 0) & (p == 0)).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return dict(precision=round(prec, 3), recall=round(rec, 3), f1=round(f1, 3),
                accuracy=round((tp + tn) / len(y), 3), tp=tp, fp=fp, fn=fn, tn=tn)


def main():
    d = build_dataset()
    rng = np.random.default_rng(SEED + 1)
    pumps = rng.permutation(N_PUMPS)
    test_ids = set(pumps[:N_TEST].tolist())
    is_test = np.array([p in test_ids for p in d["pump"]])
    Xtr, Xte = d["X"][~is_test], d["X"][is_test]
    rul_tr, rul_te = d["rul"][~is_test], d["rul"][is_test]
    y_tr, y_te = (rul_tr <= HORIZON_H).astype(int), (rul_te <= HORIZON_H).astype(int)

    clf = RandomForestClassifier(n_estimators=30, max_depth=7, min_samples_leaf=20,
                                 class_weight="balanced", random_state=42).fit(Xtr, y_tr)
    reg = RandomForestRegressor(n_estimators=30, max_depth=9, min_samples_leaf=20,
                                random_state=42).fit(Xtr, rul_tr)

    clf_trees, reg_trees = export_forest(clf, True), export_forest(reg, False)
    risk = run_forest(clf_trees, Xte)
    rul_hat = np.maximum(run_forest(reg_trees, Xte), 0)

    mae = float(np.abs(rul_hat - rul_te).mean())
    rmse = float(np.sqrt(((rul_hat - rul_te) ** 2).mean()))
    r2 = float(1 - ((rul_hat - rul_te) ** 2).sum() / ((rul_te - rul_te.mean()) ** 2).sum())
    near = rul_te <= 150
    mae_near = float(np.abs(rul_hat[near] - rul_te[near]).mean())

    metrics = dict(
        model_version="2026.11-rf30",
        horizon_hours=HORIZON_H,
        data=dict(pumps=N_PUMPS, train_pumps=N_PUMPS - N_TEST, test_pumps=N_TEST,
                  train_rows=int((~is_test).sum()), test_rows=int(is_test.sum()),
                  at_risk_share_test=round(float(y_te.mean()), 3), reading_every_hours=STEP_H),
        classifier=dict(model=prf(y_te, (risk >= 0.5).astype(int)),
                        rules_baseline=prf(y_te, rule_alarm(Xte).astype(int)),
                        importances={f: round(float(v), 3) for f, v in zip(FEATURES, clf.feature_importances_)}),
        regressor=dict(mae_hours=round(mae, 1), rmse_hours=round(rmse, 1), r2=round(r2, 3),
                       mae_hours_last_150h=round(mae_near, 1),
                       importances={f: round(float(v), 3) for f, v in zip(FEATURES, reg.feature_importances_)}),
        rules=RULES,
        note="Simulated run-to-failure data. Scores come from pumps held out of training.",
    )

    LIB.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    (LIB / "model.json").write_text(json.dumps(dict(features=FEATURES, clf=clf_trees, reg=reg_trees),
                                                separators=(",", ":")))
    (LIB / "metrics.json").write_text(json.dumps(metrics, indent=1))

    # Three held-out pumps for the lifecycle chart (readings every 6 h, predictions from the exported model)
    runs = []
    for pid in sorted(test_ids)[:3]:
        m = (d["pump"] == pid)
        idx = np.where(m)[0][::3]
        X = d["X"][idx]
        rk, rl = run_forest(clf_trees, X), np.maximum(run_forest(reg_trees, X), 0)
        runs.append(dict(
            pump=f"P-{pid + 1:02d}", life_hours=int(d["t"][m].max()),
            t=d["t"][idx].astype(int).tolist(), rul=d["rul"][idx].astype(int).tolist(),
            rul_pred=[round(float(x), 1) for x in rl], risk=[round(float(x), 3) for x in rk],
            **{f: [round(float(v), 2) for v in X[:, i]] for i, f in enumerate(FEATURES)}))
    (DATA / "runs.json").write_text(json.dumps(runs, separators=(",", ":")))

    # Fleet scatter: 500 random held-out readings
    pick = np.random.default_rng(3).choice(len(Xte), 500, replace=False)
    fleet = [dict(v=round(float(Xte[i, 0]), 2), p=round(float(Xte[i, 1]), 1), T=round(float(Xte[i, 2]), 1),
                  q=round(float(Xte[i, 3]), 1), risk=round(float(risk[i]), 2), rul=int(rul_te[i]))
             for i in pick]
    (DATA / "fleet.json").write_text(json.dumps(fleet, separators=(",", ":")))

    # Fixtures so the Node API can be checked against this Python code
    fx = []
    for i in np.random.default_rng(5).choice(len(Xte), 25, replace=False):
        rounded = np.round(Xte[i:i + 1], 3)           # score exactly what the API will receive
        fx.append(dict(input={f: float(rounded[0, j]) for j, f in enumerate(FEATURES)},
                       risk=round(float(run_forest(clf_trees, rounded)[0]), 4),
                       rul=round(float(max(run_forest(reg_trees, rounded)[0], 0)), 2)))
    (ROOT / "tests").mkdir(exist_ok=True)
    (ROOT / "tests" / "fixtures.json").write_text(json.dumps(fx, indent=1))

    size_kb = (LIB / "model.json").stat().st_size / 1024
    print(json.dumps(metrics["classifier"]["model"]), "\nrules:", json.dumps(metrics["classifier"]["rules_baseline"]))
    print("RUL MAE %.1f h | RMSE %.1f h | R2 %.3f | MAE last 150h %.1f h" % (mae, rmse, r2, mae_near))
    print("model.json %.0f KB" % size_kb)


if __name__ == "__main__":
    main()
