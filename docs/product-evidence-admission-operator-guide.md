# Product-evidence admission operator guide

## Final manual provisioning

This repository contains no private key. Generate two independent Ed25519 key
pairs in an approved offline or secrets-management environment:

- Store the base64 DER PKCS#8 producer private key as the GitHub Actions secret
  `PRODUCT_EVIDENCE_PRIVATE_KEY`.
- Store the base64 DER SPKI producer public key as the repository variable
  `PRODUCT_EVIDENCE_PUBLIC_KEY`.
- Store the base64 DER PKCS#8 admission private key as the GitHub Actions
  secret `PRODUCT_ADMISSION_PRIVATE_KEY`.
- Install the matching admission public key in the operator-owned system trust
  root on every machine that can run `quality-run.js`:
  `/etc/claude-kit/product-admission-public-key` on Linux,
  `/Library/Application Support/claude-kit/product-admission-public-key` on
  macOS, or `C:\ProgramData\claude-kit\product-admission-public-key` on Windows.

Do not place either private key in a repository variable, workflow output,
artifact, log, environment file, or local project configuration.

## Rotation

1. Create a new producer pair and a new admission pair.
2. Update the producer public repository variable and both protected secrets.
3. Install the new admission public key at every system trust root before
   requesting new admissions.
4. Run a new exact-head admission. Old admissions fail after rotation by design.
5. Revoke the old secrets only after the new admission succeeds.
