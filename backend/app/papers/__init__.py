"""Reproduce a paper: find an arXiv paper's OpenQASM circuits and run them (app/routers/papers.py).

* fetch.py     the only way out to the internet: a fixed list of arXiv and GitHub hosts, the SSRF
               check from app/outbound.py on every hop, size and time limits
* archive.py   reads tar/gzip/zip archives in memory (nothing is written to disk) with limits on
               files, sizes and unpacked bytes; refuses traversal names, links and devices
* circuits.py  finds OpenQASM 2/3 in the files and parses it with Qiskit's QASM readers only,
               within width, depth and gate-count limits. Code from papers is never executed.
* compare.py   the paper's reported numbers next to the run's, and a one-line verdict
* service.py   ties them together for one arXiv id, with a short cache
"""
