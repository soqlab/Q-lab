# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue.

- **GitHub:** use [Report a vulnerability](https://github.com/soqlab/Q-lab/security/advisories/new)
  on the Security tab (preferred: it keeps the report private and lets us credit you).
- **Email:** contact@soqlab.com with "Security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. If you have
a proof of concept, attach it; please do not run it against other people's data on
qlab.soqlab.com.

## What to expect

- We acknowledge reports within 3 working days.
- We confirm the issue and agree a fix timeline within 10 working days.
- We fix and release, then publish an advisory. We credit you unless you ask us not to.

We will not take legal action against research done in good faith under this policy: testing your
own account or your own self-hosted install, not degrading the service, and not accessing,
keeping or sharing other users' data.

## Supported versions

Security fixes go to the latest release and to the hosted service at qlab.soqlab.com. Self-hosted
installs should run the latest tagged release.

## Verifying a release

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml) when a
`vX.Y.Z` tag is pushed. Nothing is signed with a long-lived key: every image and release file
carries a keyless Sigstore signature or attestation, issued through GitHub's OIDC token, that names
this repository, that workflow file and the tag. Replace `1.2.3` with the version; you need the
[GitHub CLI](https://cli.github.com/) 2.49 or later, and [cosign](https://github.com/sigstore/cosign)
2.5 or later for the last check.

```sh
# Release files (SDK wheel and sdist, SBOMs): checksums, then provenance for each file.
gh release download v1.2.3 --repo soqlab/Q-lab --dir qlab-1.2.3 && cd qlab-1.2.3
sha256sum -c SHA256SUMS
for f in *.whl *.tar.gz *.cdx.json; do
  gh attestation verify "$f" --repo soqlab/Q-lab \
    --signer-workflow soqlab/Q-lab/.github/workflows/release.yml
done

# Images: build provenance, and the plain cosign signature.
gh attestation verify oci://ghcr.io/soqlab/qlab-backend:1.2.3 --repo soqlab/Q-lab
cosign verify ghcr.io/soqlab/qlab-backend:1.2.3 \
  --certificate-identity "https://github.com/soqlab/Q-lab/.github/workflows/release.yml@refs/tags/v1.2.3" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Repeat the image checks for `qlab-frontend`. The `qlab-sdk` package on PyPI is published with
trusted publishing and carries PEP 740 attestations, shown on its PyPI page under "Provenance".

## In scope

- The Q-Lab backend API, dashboard and the `qlab-sdk` Python package in this repository.
- Run privacy: one user reading or changing another user's runs, projects or credentials.
- Authentication, API keys, OAuth sign-in and the stored provider credentials.

## Out of scope

- Findings that need a compromised machine or a malicious administrator of a self-hosted install.
- Missing security headers or best-practice suggestions without a demonstrated impact.
- Denial of service by sending large amounts of traffic.
- Experimental "Labs" tools, unless the issue lets you reach other users' data.
