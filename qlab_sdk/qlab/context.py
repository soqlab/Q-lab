import subprocess
import sys
import platform
from typing import Dict, Any

def _safe_command(command: list[str]) -> str | None:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=3,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        return None

    return None

def _capture_library_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    packages = [
        "qiskit",
        "qiskit-ibm-runtime",
        "qiskit-ibm-provider",
        "qiskit-aer",
        "qiskit-terra",
    ]
    try:
        import importlib.metadata
        for pkg in packages:
            try:
                versions[pkg] = importlib.metadata.version(pkg)
            except Exception:
                pass
    except Exception:
        pass
    return versions

def capture_context(include_pip_freeze: bool = False) -> Dict[str, Any]:
    context: Dict[str, Any] = {
        "python_version": sys.version,
        "platform": platform.platform(),
        "git_commit": _safe_command(["git", "rev-parse", "HEAD"]),
        "git_branch": _safe_command(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        "library_versions": _capture_library_versions(),
    }

    if include_pip_freeze:
        context["pip_freeze"] = _safe_command(
            [sys.executable, "-m", "pip", "freeze"]
        )

    return context
