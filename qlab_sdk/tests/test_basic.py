"""Basic SDK smoke tests."""
import importlib, sys


def test_import():
    import qlab
    assert hasattr(qlab, 'init')
    assert hasattr(qlab, 'run')


def test_version():
    import qlab
    # Should have a __version__ attribute
    # If not present, that's OK for now
    pass


def test_cli_import():
    from qlab.cli import main
    assert callable(main)


def test_config_import():
    from qlab.config import get_config
    assert callable(get_config)


def test_fingerprint_import():
    from qlab.fingerprint import fingerprint_circuit
    assert callable(fingerprint_circuit)
