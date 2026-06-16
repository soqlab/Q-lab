"""
VQE example showing qlab.run() context manager with per-iteration metric logging.
This is the pattern for iterative quantum algorithms (VQE, QAOA, QML).
"""
import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter

import qlab

qlab.init(
    api_url="http://localhost:8000",
    api_key="your-api-key",
    project="vqe-h2",
    tags=["vqe", "hydrogen"],
)

# Build a parametrized ansatz
theta = Parameter("θ")
qc = QuantumCircuit(2)
qc.ry(theta, 0)
qc.cx(0, 1)
qc.ry(theta, 1)

# Simulated VQE optimization loop
def fake_energy(t: float) -> float:
    """Simulates convergence of VQE energy."""
    return -1.85 + 0.8 * np.exp(-t / 5) * np.cos(t) + np.random.normal(0, 0.01)

def fake_variance(t: float) -> float:
    return 0.5 * np.exp(-t / 8) + np.random.normal(0, 0.005)

# Track the whole optimization as one run
with qlab.run(qc, backend_name="aer_simulator", project="vqe-h2") as r:
    theta_val = 0.0
    learning_rate = 0.3

    for step in range(50):
        energy = fake_energy(step)
        variance = fake_variance(step)
        grad = (fake_energy(theta_val + 0.01) - fake_energy(theta_val - 0.01)) / 0.02

        # Log all metrics at this optimization step
        r.log_metrics(
            {
                "energy": energy,
                "energy_variance": variance,
                "gradient_norm": abs(grad),
                "theta": theta_val,
            },
            step=step,
        )

        theta_val -= learning_rate * grad
        learning_rate *= 0.99  # decay

        if step % 10 == 0:
            print(f"Step {step:3d}: E = {energy:.6f} Ha,  θ = {theta_val:.4f}")

    r.finish(status="completed")

print("Run logged — view at http://localhost:3000")
