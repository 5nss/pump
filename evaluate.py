from sklearn.metrics import classification_report

def evaluate_model(model, X_test, Y_test):
    Y_pred = model.predict(X_test)
    report = classification_report(Y_test, Y_pred)
    print(report)
