"""Automatic capture for quantum providers other than plain Qiskit.

``qlab.init()`` calls :func:`patch_installed`, which hooks every provider SDK that is
installed and skips the others, so ``import qlab`` never needs them:

* Amazon Braket (``pip install qlab-sdk[braket]``): ``device.run`` / ``device.run_batch`` of
  every Braket device (``LocalSimulator``, ``AwsDevice``). See :mod:`qlab.providers.braket`.
* IonQ (``pip install qlab-sdk[ionq]``): runs on qiskit-ionq backends are captured by the
  Qiskit hooks; this adds the provider, device, noise model and IonQ characterization.
  See :mod:`qlab.providers.ionq`.
"""

from __future__ import annotations


def patch_installed() -> dict[str, bool]:
    """Hook each installed provider SDK. Returns {provider: hooked}."""
    hooked: dict[str, bool] = {}
    for name in ("braket", "ionq"):
        try:
            module = __import__(f"{__name__}.{name}", fromlist=["patch"])
            hooked[name] = bool(module.patch())
        except Exception:
            hooked[name] = False
    return hooked
