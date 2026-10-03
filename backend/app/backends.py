"""
Central registry for quantum hardware backends.

To add a new backend
---------------------
Add one entry to QUANTUM_BACKENDS below. That's it for the UI layer —
the credentials form, filter pills, labels, and colors all read from here.

For deeper integration (live job submission, calibration data, token test):
  - credentials.py  → add a test_credential branch
  - hardware_jobs.py → add a job submission branch
  - calibration_oracle.py → add a calibration fetch branch
"""

QUANTUM_BACKENDS: dict[str, dict] = {
    "ibm": {
        "label": "IBM Quantum",
        "color": "#6929c4",
        "docs_url": "https://quantum.ibm.com",
        "credential_hint": "Get your API token at quantum.ibm.com → Account → API Token",
    },
    "ionq": {
        "label": "IonQ",
        "color": "#0f62fe",
        "docs_url": "https://cloud.ionq.com",
        "credential_hint": "Get your API key at cloud.ionq.com → Settings → API Keys",
    },
    "rigetti": {
        "label": "Rigetti",
        "color": "#2b5ce6",
        "docs_url": "https://docs.rigetti.com",
        "credential_hint": "Get your API key from the Rigetti QCS dashboard",
    },
    "braket": {
        "label": "Amazon Braket",
        "color": "#ff9900",
        "docs_url": "https://aws.amazon.com/braket",
        "credential_hint": "Use your AWS access key or a Braket-specific API key",
    },
}

QUANTUM_BACKEND_IDS: set[str] = set(QUANTUM_BACKENDS)
