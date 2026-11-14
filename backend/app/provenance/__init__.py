"""Provenance certificates: a signed statement of what Q-Lab recorded about a run, and whether it reproduced.

    certificate.py  the certificate body, the reproduction state, signing, the badge
    signing.py      which key signs (QLAB_CERT_SIGNING_KEY, else Rewind's QLAB_REWIND_SIGNING_KEY)
    verify.py       the format and its check; runs on its own (stdlib + cryptography)
"""
