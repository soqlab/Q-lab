# Third-party notices

Q-Lab is MIT licensed (see [LICENSE](LICENSE)). It depends on open-source packages under their
own licences. They are installed from PyPI and npm, unmodified; the Docker images contain them.

Every dependency uses a permissive licence (MIT, BSD, Apache-2.0, ISC, PSF, 0BSD,
CC-BY-4.0 for browser-support data), except these, which are LGPL and are used as unmodified
libraries:

| Package | Licence | Used for |
|---|---|---|
| [psycopg](https://www.psycopg.org/) | LGPL-3.0-only | PostgreSQL driver |
| [psycopg2-binary](https://www.psycopg.org/) | LGPL-3.0 with exceptions | PostgreSQL driver (legacy) |
| [paramiko](https://www.paramiko.org/) | LGPL-2.1 | SSH for the HPC bridge (Labs) |

Their source code is available from the linked projects, and you may replace them with your own
builds. Nothing in Q-Lab is GPL- or AGPL-licensed.

Full, per-package licence data for each release is in the CycloneDX SBOMs attached to the
[GitHub release](https://github.com/soqlab/Q-lab/releases).
