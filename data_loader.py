import pandas as pd
import numpy as np

def generate_dummy_pump_data(n=1000):
    np.random.seed(42)
    vibration = np.random.normal(loc=0.0, scale=1.0, size=n)
    pressure = np.random.normal(loc=100, scale=10, size=n)
    temperature = np.random.normal(loc=75, scale=5, size=n)
    flow_rate = np.random.normal(loc=30, scale=3, size=n)
    fault = ((vibration > 1.5) | (pressure < 85) | (temperature > 85) | (flow_rate < 25)).astype(int)
    data = pd.DataFrame({
        'vibration': vibration,
        'pressure': pressure,
        'temperature': temperature,
        'flow_rate': flow_rate,
        'fault': fault
    })
    return data
