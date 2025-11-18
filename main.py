from data_loader import generate_dummy_pump_data
from feature_engineering import select_features
from model import train_model
from evaluate import evaluate_model
from sklearn.model_selection import train_test_split

# Load data
df = generate_dummy_pump_data()
X = select_features(df)
Y = df['fault']

# Split data
X_train, X_test, Y_train, Y_test = train_test_split(X, Y, test_size=0.3, random_state=55)

# Train model
model = train_model(X_train, Y_train)

# Evaluate model
evaluate_model(model, X_test, Y_test)
