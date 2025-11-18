def select_features(df):
    features = ['vibration', 'pressure', 'temperature', 'flow_rate']
    return df[features]
