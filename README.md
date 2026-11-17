# Pump Analysis

Fault detection and Remaining Useful Life (RUL) estimation for centrifugal pumps, with a web dashboard and a JSON API.

Four sensors (vibration, pressure, temperature, flow rate) go in. Two random forests answer:

- **Will this pump fail within 48 hours?** (failure risk)
- **How many hours of useful life are left?** (RUL)

## How it works

```
backend/train.py  ->  api/_lib/model.json  ->  api/predict.js  ->  public/ dashboard
 simulate + train      exported forests        serverless API       charts and sliders
```

1. `backend/train.py` simulates 60 pumps from new to failure, splits them **by pump** (48 train, 12 test), trains a classifier and a regressor with scikit-learn, and exports both forests to JSON.
2. `api/predict.js` loads the JSON and runs the forests in Node, so Vercel needs no Python runtime.
3. `public/` is the dashboard: live diagnosis, run-to-failure replay, model scores, bench data.

The scores on the Model tab are computed from the **exported** forests on pumps held out of training, so they describe what the API serves.

## API

| Route | Purpose |
|---|---|
| `GET/POST /api/predict` | `vibration`, `pressure`, `temperature`, `flow_rate` in, `failure_risk`, `rul_hours`, `status`, `rule_alarms` out |
| `GET /api/metrics` | Held-out test scores, importances, comparison with fixed rules |
| `GET /api/health` | Backend and model liveness |

```bash
curl "https://<your-site>/api/predict?vibration=1.2&pressure=92&temperature=74&flow_rate=29.5"
```

## Run locally

```bash
npm run dev      # http://localhost:3000 (static files + API)
npm test         # checks the JS API against the Python model
npm run train    # retrain (needs numpy, scikit-learn: pip install -r requirements.txt)
```

## Results (simulated data, 12 held-out pumps)

| | Random forest | Fixed rules |
|---|---|---|
| Accuracy | 95.9% | 81.8% |
| Precision | 71.9% | 35.4% |
| Recall | 96.6% | 100% |
| RUL error (MAE) | 64.6 h (28.7 h in the last 150 h) | n/a |

The rules catch every failure but raise 542 false alarms against 112 for the model.

## Limits

The data is simulated, so these numbers show that the method works, not how a particular real pump will behave. Next step: train on real run-to-failure logs.

## Original scripts

`data_loader.py`, `feature_engineering.py`, `model.py`, `evaluate.py`, `main.py` are the first version of the project: a random forest fault classifier on rule-labelled data. `centrifugal_pump_demo_table.csv` holds the nine bench test runs shown on the Bench data tab.
