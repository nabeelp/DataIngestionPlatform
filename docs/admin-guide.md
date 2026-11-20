# Administrator Guide

## Responsibilities and Architecture

Administrators manage users, definition access, validation rules and operational
health. Operators manage the Node API, React frontend, Python rules service and
worker, SQL, Blob Storage, Service Bus and Azure infrastructure. The
[architecture](architecture.md) and [deployment runbook](deployment.md) are the
sources for detailed topology and operations. This is a proof of concept.

## Prerequisites

For local development use Docker Desktop, Node.js 24, Python 3.12 with `uv`,
and PowerShell. Review the SQL Server and Service Bus emulator license terms
before accepting them. Azure operations additionally require a subscription,
supported region, Azure CLI, Azure Developer CLI, Bicep, appropriate RBAC,
Entra app registrations and a customer-authorized model gateway. See
[deployment prerequisites](deployment.md#prerequisites); capacity and regional
service availability must be checked for the target subscription.

## Installation

Follow [local development](../README.md#local-development) to install
dependencies, configure ignored environment files and run `.\start.ps1`.
It starts local emulators and seeds development accounts; do not use that
bootstrap as a production identity lifecycle.

For Azure, review the [preview and provisioning steps](deployment.md#preview-provision-and-deploy),
costs and resource changes, then obtain explicit owner approval before
provisioning. Do not use a reset or teardown as an installation shortcut.

## Configuration

The local [backend example](../Back-End/.env.example) lists configuration names
and defaults; the [frontend example](../Front-End/.env.example) covers local
Vite settings, and the [Python example](../Validation-Service/.env.example)
covers a standalone rules service or worker. Keep actual values in ignored,
access-controlled files or an approved secret store.

Key settings include `DB_CONNECTION_STRING`, `JWT_SECRET`,
`SERVICEBUS_CONNECTION_STRING`, `AZURE_STORAGE_CONNECTION_STRING` and
`RULES_SERVICE_DEV_KEY` for local setup. `CITADEL_ENDPOINT` and
`CITADEL_SUBSCRIPTION_KEY` are required for natural-language authoring; the
endpoint has no usable default. Azure uses managed identity for data services
and Key Vault references for secrets. See [parameters and secrets](deployment.md#parameters-and-secrets)
for Azure-specific settings.

## Identity, Secrets, and TLS

Use least-privilege deployment and runtime identities. The API supports
application password and optional Entra SSO; the rules service uses Entra
authentication in Azure and a shared development key locally. Disable local
bypasses outside development. The browser app JWT is stored in localStorage
and cannot currently be revoked; first-admin bootstrap and password recovery
are also open issues. Rotate secrets according to the operator's policy.
Azure ingress uses HTTPS; SQL, Blob and Key Vault use private endpoints.
Service Bus and the authenticated rules service have public endpoints in this
PoC, so review network policy before use.

## Storage and Backups

SQL holds metadata and results; Blob stores uploads, reports, templates,
staging and deliveries. The staging lifecycle and Blob soft-delete settings
do not constitute an end-to-end backup, retention or disaster recovery plan.
Agree retention, SQL and Blob backup coverage, restore testing, RPO and RTO
with the owner. Never reset or delete data without explicit approval and a
verified recovery plan; see [post-deployment checks](deployment.md#post-deployment-checks).

## Health Checks and Monitoring

Locally, check `http://localhost:3000/health`,
`http://localhost:8000/healthz` and `http://localhost:5173`. In Azure, follow
the [post-deployment checks](deployment.md#post-deployment-checks) for API and
frontend health, authentication, messaging and telemetry. Health endpoints
alone do not prove dependency readiness. Review queue and dead-letter counts
where supported, logs and Application Insights. Alerting and SLOs are not yet
implemented; telemetry ingestion and gateway calls incur costs.

## Upgrades and Rollback

Run the [testing checks](../README.md#testing), review schema compatibility,
capture current image digests and configuration, and back up data before a
change. Review infrastructure changes with
`azd provision --preview --environment <environment>` and obtain approval
before provisioning.
Deploy shared-contract changes across API, rules service, frontend and worker.
Do not assume an image-only rollback is compatible with a changed schema; a
formal rollback record remains open. See the
[deployment runbook](deployment.md#post-deployment-checks).

## Troubleshooting

- **GitHub `azd env refresh` returns 403:** verify that the dispatched
  environment name resolves to the intended existing resource group and the
  deployment identity has the documented permissions. The workflow defaults to
  `dev`; the previously deployed reference group used `sbfracent`. A successful
  OIDC sign-in does not prove access to the selected group. Run the workflow's
  `validate` target first after correcting the selection.
- **Local emulator startup timeout:** inspect the Service Bus and its SQL
  container logs using the [local troubleshooting procedure](../README.md#service-bus-emulator-startup-troubleshooting).
  Preserve data; do not delete all Docker volumes.
- **Stuck validation or delivery:** inspect current status, worker and queue
  diagnostics without exposing payloads. Queue handoff recovery and stale
  delivery-attempt handling remain open; avoid blindly replaying work.
- **Rule authoring fails:** check the gateway endpoint, key reference, model
  deployment and rules-service authentication without printing credentials.
- **Schema incompatibility:** stop and plan a backed-up migration; local
  schema tooling fails rather than silently replacing incompatible tables.

## Security and Privacy Checklist

- Use customer-approved identity, gateway, data handling and regions.
- Keep secrets out of Git, logs and support tickets; use Key Vault in Azure.
- Review network exposure, RBAC, TLS, token lifecycle and dependency advisories.
- Use synthetic data for demonstrations until the production gate is closed.
- Do not treat model validation or example tests as proof of semantic correctness.
- Review [handover limitations](poc-handover.md#close-before-production-or-real-customer-data)
  before using real customer data.

## Recovery and Support

The operator owns backup, restore, incident response and first-admin recovery
procedures; they are not yet complete in this project. Record and test these
procedures before production. Consult the [backlog](../TODO.md), repository
issue tracker and the responsible Azure or gateway administrators; redact
secrets and customer data from diagnostics.
