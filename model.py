from sklearn.ensemble import RandomForestClassifier

def train_model(X_train, Y_train):
    model = RandomForestClassifier(random_state=42)
    model.fit(X_train, Y_train)
    return model
