# Q-Lab transparency log

One line per deploy of main in transparency/log.jsonl, written by
.github/workflows/transparency.yml on main. When an entry is signed, its `signed` field holds
the exact bytes that were signed and transparency/bundles/<commit>.sigstore.json the Sigstore
bundle. Verify with:

    jq -j .signed <<< "$LINE" > entry.json
    cosign verify-blob --bundle transparency/bundles/<commit>.sigstore.json \
      --certificate-identity-regexp "^https://github.com/soqlab/Q-lab/.github/workflows/transparency.yml@" \
      --certificate-oidc-issuer https://token.actions.githubusercontent.com entry.json

Nothing else writes to this branch.
