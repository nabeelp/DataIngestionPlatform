# Proof-of-concept handover

This repository is handed over as a **proof of concept (PoC)**: it demonstrates the end-to-end upload, validation and delivery
flow on Azure-native services. It is **not production-ready**. This page states what is in scope, what was verified, what the
customer must supply, the limits to expect, and what to close before any production or real-customer-data use.

## Scope of the PoC

| In scope (demonstrable) | Out of scope (not built or not proven) |
|---|---|
| Versioned file definitions, column checks and rules (built-in and natural-language) | Production identity lifecycle (first-admin bootstrap, password reset, session revocation) |
| Upload of CSV/TSV/TXT/Excel, asynchronous validation, per-rule results and issues report | Retention and deletion policy, malware scanning, DR and multi-region |
| Optional delivery of validated files to a Blob container; owner-authorized download | Horizontal scale of the API (single replica by design) |
| Admin user management, audit of admin writes, monitoring page, Application Insights telemetry | SLOs, alerting, runbooks, load and dense-error performance proof |
| Local stack (Docker Compose) and an `azd`/Bicep Azure deployment | Live end-to-end acceptance in Azure (see below) |

## Verified state

Checked against the source at the time of this review (November 2026):

| Check | Result |
|---|---|
| Backend: zero-warning lint, type check, unit tests, build | Pass (402 tests; 4 database-backed suites skip without `TEST_DB_CONNECTION_STRING`) |
| Frontend: zero-warning lint, unit tests, production build | Pass (205 tests) |
| Validation service: `uv run pytest` including the golden sample corpus | Pass (436 tests, 1 skipped) |
| `node scripts/check-docs.mjs` (links, removed concepts, documented settings exist) | Pass |
| Dependency advisories | Backend production advisories were reduced by an in-range `npm audit fix` (the critical `proxy-addr` finding and the high findings in `multer`, `body-parser`, `ws`, `socket.io-parser` and others); one moderate OpenTelemetry finding remains. The frontend audit was not completed (SEC-01) |
| Local stack, browser (Playwright) suites and sample-corpus run | Manual gates; run before each demo or release ([README](../README.md#testing)) |
| Azure deployment | Infrastructure compiled and previewed; API, frontend and rules service were deployed to a development environment. **Authenticated delivery, replay, download and deletion in Azure (OPS-01) has not been accepted.** |

## What the customer must supply or replace

Nothing below is shipped as a customer value. Replace each before first use in the customer's tenant.

1. **Azure subscription, region and approvals.** The documented target region is France Central; confirm capacity with
   `azd provision --preview` and obtain approval before any provisioning ([deployment](deployment.md)).
2. **Model gateway.** Rule authoring calls a Citadel/Azure API Management gateway. The repository defaults
   (`CITADEL_ENDPOINT` in `Back-End/src/config/appConfig.ts`, `infra/main.bicep`, `infra/main.bicepparam`, `Back-End/.env.example`)
   point at the original developer's gateway. Set `CITADEL_ENDPOINT`, `CITADEL_MODEL`, `CITADEL_SUBSCRIPTION_KEY` and
   `CITADEL_SUBSCRIPTION_KEY_HEADER` to the customer's gateway. Rule text and schema names (never file contents) leave the platform.
3. **Entra registrations.** A single-tenant SSO app registration and a Rules API registration with the `access_as_application`
   role, and an administrator to consent ([deployment](deployment.md#parameters-and-secrets)).
4. **Secrets.** Generate a new `JWT_SECRET`, SSO client secret and Citadel key. Rotate the SSO secret before its one-year expiry.
   Nothing secret is committed; `.env` files are git-ignored.
5. **CI/CD identity.** The GitHub OIDC federated-credential subject in the deployment guide belongs to the original repository.
   Create a new deployment identity and subject for the customer's repository.
6. **First administrator.** There is no production bootstrap (AUTH-02). Decide SSO-only or a password lifecycle, and seed the first
   admin deliberately. The seeded mock accounts and `password123` are **local development only**; they are ignored unless
   `NODE_ENV=development` and `DEV_BYPASS_AUTH=true`, and must never be deployed.
7. **Licence.** The repository carries no licence file (HAND-01). Agree ownership and licensing terms before the customer reuses the code.
8. **Container and SQL Server emulator licences** for local use are accepted by the person running Docker Compose (`ACCEPT_EULA`).

## Known limits to accept for a PoC

These are documented product or platform choices, not defects. The full backlog with priorities is in [TODO.md](../TODO.md).

- **Single API replica** (Socket.IO and the delivery consumer run in-process); no zone redundancy or DR.
- **Public endpoints with authentication:** Service Bus (Entra-only, no IP allowlist), the rules service (Easy Auth), ACR and
  Application Insights. SQL, Blob and Key Vault use private endpoints.
- **Session model:** a 24-hour app JWT kept in browser `localStorage` that cannot be revoked (AUTH-01).
- **No malware scanning** of uploaded files and **no retention policy** for uploads, reports or deliveries (DATA-01).
- **Natural-language rules** reduce but do not prove semantic equivalence to the request; an admin reviews and publishes every rule.
- **Performance** was measured on a developer host only (1M-row CSV with 18 rules in about 1.2 s); dense-error files are unproven (PERF-01).
- **Whole-upload pass/fail:** warnings do not fail an upload; uploads for definitions with no delivery folder finish as `VALIDATED`.

## Close before production or real customer data

Minimum gate, in order (priority IDs refer to [TODO.md](../TODO.md)):

1. Run and record the authenticated Azure acceptance workflow (OPS-01) and fix stale delivery attempts (FUN-04).
2. Fix delete behaviour for definitions and uploads (FUN-02, FUN-03) and make database-to-queue handoff recoverable (FUN-05).
3. Put the session design and first-administrator lifecycle in place (AUTH-01, AUTH-02).
4. Close validation-semantics gaps (VAL-01 to VAL-03) and CSV export formula injection (EXP-01).
5. Define retention, malware scanning, alerts, SLOs, RPO/RTO and a rollback record (DATA-01, OPS-06, OPS-08).
6. Resolve dependency advisories and move the lockfiles off third-party package mirrors (SEC-01, PKG-01), and add a CI job that runs against a disposable SQL Server and the
   Service Bus emulator (QA-01).
7. Re-assess the networking deviations in [architecture](architecture.md#12-risks-gaps-and-recommendations) against customer policy.

## Suggested demo path

1. `.\start.ps1` (local, mock login) or the deployed environment with Entra SSO.
2. As admin, create a definition from an example file in [samples](../samples/README.md), add an Enum or Range rule and a
   plain-language rule, then **Publish version 1**.
3. As a user, upload a valid and an invalid sample file; open results, the issues report and the pinned definition version.
4. Show the Monitoring page, audit log and (in Azure) the Application Insights transaction for one upload.
5. Publish a second version and show that earlier uploads stay pinned to version 1.

## Cost and clean-up

Main cost drivers and the teardown warning are in [deployment](deployment.md#cost-and-teardown). The PoC is not a zero-cost
sandbox: the API replica, Service Bus Standard, private endpoints and Log Analytics run continuously. Tear the environment down
when the PoC ends, after backing up anything to keep, and with explicit owner approval.
