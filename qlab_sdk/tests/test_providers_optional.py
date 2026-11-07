"""The provider SDKs are optional: qlab imports and initialises without them."""

import subprocess
import sys
import textwrap


def test_import_and_init_without_braket_or_ionq():
    # Make both SDKs unimportable in a fresh interpreter, whether or not they are installed.
    code = textwrap.dedent("""
        import sys
        for name in ("braket", "braket.devices", "braket.circuits", "qiskit_ionq"):
            sys.modules[name] = None
        import qlab
        from qlab import providers
        qlab.init(api_url="http://127.0.0.1:9")
        assert providers.patch_installed() == {"braket": False, "ionq": False}, providers.patch_installed()
        print("ok")
    """)
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300,
                         env={**__import__("os").environ, "QLAB_TELEMETRY": "off"})
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().endswith("ok")
