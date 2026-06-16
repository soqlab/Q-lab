from pathlib import Path
from typing import Any


def load_config(config_path: str | None = None) -> dict[str, Any]:
    path = Path(config_path or "qlab.toml")
    if not path.exists():
        return {}

    try:
        import tomllib
    except Exception:
        return {}

    try:
        with path.open("rb") as file:
            data = tomllib.load(file)
    except Exception:
        return {}

    qlab_config = data.get("qlab", data)
    if not isinstance(qlab_config, dict):
        return {}

    return qlab_config
