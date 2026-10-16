# Azure deployment

The repository contains an `azd`/Bicep deployment for the API, React SPA,
Python validation service and worker, plus Azure SQL, Blob Storage, Service
Bus, Key Vault, Container Registry, monitoring and private networking.

**Status.** The target is France Central (earlier attempts in East US 2 and
Central US failed on regional SQL and Container Apps capacity; soft-deleted Key
Vaults remain in those regions and have not been purged). The frontend runs in
Container Apps because Azure Static Web Apps is not offered in France Central.
The API, frontend and rules service are deployed; the frontend scales from zero
to two replicas on an HTTP concurrency rule. The latest check returned HTTP 200
from the frontend health, root and runtime-config routes and the API health
route; the rules service requires Entra authentication; SQL bootstrap succeeded
and restored the configured SQL administrator. Authenticated OPS-01 cloud
workflow acceptance (delivery, replay, owner-authorized download and deletion)
remains pending a test identity and test data. Provider metadata and quota
retrieval do not guarantee capacity, so run `azd provision --preview` first.

## Local development remains independent

Azure is not required to run the local stack. Use the root [`start.ps1`](../start.ps1)
and the local settings described in the [README](../README.md#local-development).
The local API and Python service continue to use the emulator connection strings,
`DB_CONNECTION_STRING`, and `RULES_SERVICE_DEV_KEY` from local `.env` files.
Azure managed identity and Entra rules-service authentication are enabled only
by the Azure Container Apps configuration. Never copy Azure secrets or connection
strings into committed files.

## Prerequisites

- An Azure subscription and region supported by Azure Container Apps workload
  profiles, Azure SQL serverless and Service Bus Standard (France Central is the
  target; it does not offer Static Web Apps).
- Azure CLI, Azure Developer CLI (`azd`), Bicep, Node.js 24 and PowerShell 7
  (`pwsh`). Docker is optional when ACR remote
  builds succeed; `azd` may use a local container engine as a fallback.
- A signed-in deployment operator. The operator needs permission to create the
  listed resource types and assign RBAC roles. Use **Owner** or **Contributor**
  plus **User Access Administrator** at the resource-group scope. A narrower,
  approved custom role may be used if it includes all required actions.
- Permission to create/configure the single-tenant Microsoft Entra SSO and Rules
  API app registrations, and to grant the API managed identity an application
  role on the Rules API registration. An Entra administrator may need to
  complete or consent to the directory operations.
- For the optional Foundry role assignment, the existing Foundry project
  resource ID and permission to assign **Azure AI User** on that project.

The `sbingest` setup uses a single-tenant SSO registration and a dedicated
single-tenant Rules API registration with the `access_as_application` role. The
postprovision hook configures the API's exact frontend CORS origin and callback,
adds the frontend callback URI to the SSO registration, and grants the Rules
API role to the API managed identity. The Container Apps auth policy also
limits accepted audiences and client applications to this API. Rotate the SSO
client secret before its one-year expiry; never print or commit it.

## Managed identity permissions

The RBAC module scopes data-plane access to individual containers and messaging
entities wherever Azure supports it:

| Identity | Scope and role |
|---|---|
| API | Blob Data Contributor on `uploads`, `reports`, and `templates`; Service Bus Data Sender on `validation-requests`, Data Receiver on the `validation-events/api` subscription, and Sender/Receiver on `delivery-requests`; Key Vault Secrets User; ACR Pull; Azure AI User on the optional existing Foundry project |
| Worker / rules-service | Blob Data Reader on `uploads`, Blob Data Contributor on `reports` and `staging`; Service Bus Data Receiver on `validation-requests` and Data Sender on `validation-events`; Key Vault Secrets User for its monitoring secret; ACR Pull |
| SQL bootstrap | ACR Pull; temporarily configured as the SQL Entra administrator only while the private-network bootstrap job runs |
| Frontend | ACR Pull only; no application data or secret access |
| API and worker | SQL contained users with `db_datareader` and `db_datawriter`, created by the in-VNet bootstrap job |

The bootstrap job uses the managed identities' client IDs to create contained
users with explicit SIDs, avoiding a Microsoft Graph lookup from the SQL
service. The IDs are supplied by the Bicep identity resources; SQL does not
validate these principals against Microsoft Entra during user creation.

The API has Blob Data Contributor on `reports` because the existing upload
cleanup route deletes its persisted report using the API identity. This role is
limited to the reports container; the worker writes the reports.

## Networking and authentication decisions

- SQL, Blob Storage and Key Vault use private endpoints and private DNS from the
  Container Apps VNet. SQL uses Entra-only authentication from server creation;
  Azure generates an unusable SQL-auth password, and no SQL bootstrap password
  is stored or used. The
  schema bootstrap runs in a manual Container Apps Job inside the VNet; the
  deployment host does not need private SQL connectivity.
- Service Bus uses Standard because Private Link and virtual network service
  endpoints require Premium. The Consumption Container Apps environment does
  not expose an outbound IP list, so the selected cost-conscious design keeps
  the Service Bus public endpoint reachable without an IP allowlist. Local/SAS
  authentication is disabled; callers still require Entra authentication and
  the appropriate Service Bus data-plane RBAC role. Use NAT Gateway plus a
  static egress IP, or Premium with Private Link, if network-level restriction
  is required.
- ACR uses Basic because Private Link is unavailable at that tier. Its admin
  account is disabled; Container Apps pull images using managed identities.
- The API and SPA Container App are externally reachable over HTTPS. The
  frontend scales from zero to two replicas on HTTP concurrency (10 requests
  per replica) and uses a dedicated identity with only ACR Pull. The rules-service
  is also externally reachable but requires Container Apps built-in Entra authentication
  and allows only the API managed identity and configured audience. This is an
  intentional, owner-selected deviation from the plan's internal-ingress
  preference: Microsoft documents Container Apps built-in auth for
  external-ingress apps. The endpoint is not anonymous, but it has a public
  address; preserve the issuer, audience, allowed-application and 401 settings.
  If policy requires a private-only endpoint, change to service-level bearer
  token validation before removing the external ingress.
- The SPA receives the API base URL (`/api/v1`) through a no-store runtime
  configuration file, so one image can be promoted without embedding an
  environment-specific URL. Socket.IO uses the API origin rather than the SPA
  origin. The API uses managed identity for SQL, Blob Storage, Service Bus,
  Key Vault and the rules-service token.

## API proxy trust and rate limiting

The API uses `TRUST_PROXY_HOPS` to configure Express before any middleware.
Unset defaults to `0` for direct local access; the API Container Apps template
sets `1` for the direct Container Apps ingress path. Values must contain only
decimal digits and represent a non-negative safe integer. Invalid values fail
startup rather than silently changing the trust boundary.

[Container Apps ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview#http-headers)
appends to `X-Forwarded-For` and supplies only its rightmost IP. Trusting one hop
uses that IP for the global API, login, and admin-stats rate limiters, ignoring
untrusted prefixes supplied by clients. Do not set Express proxy trust to
boolean `true`, disable rate-limit validation, or select the leftmost header IP.
Reassess this setting if another proxy is introduced or callers can reach the
container listener through a shorter path.

To deploy this fix, apply the API template setting using the existing
`azd provision` workflow, then build and deploy the API with `azd deploy api`.
Provisioning can affect other infrastructure: review those changes before
running it. Updating the environment variable alone on an old API image does
not fix the issue; both the rebuilt image and the setting are required.
An API image-only deployment to an existing Container App also does not apply
new Bicep environment settings.

Verify the active API image/revision and only the non-secret
`TRUST_PROXY_HOPS` setting. Check `/health`, then send normal authenticated
`/api/v1` requests and inspect fresh revision logs for
`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`; `/health` does not exercise rate limiting.
Local regression tests cover separate client buckets and spoofed header
prefixes. Confirm the live ingress path during deployment without exposing a
public IP-debug endpoint or exhausting production rate limits.
If acceptance fails, restore the previous API image and environment
configuration together using the existing revision/deployment workflow.

This fix adds no Azure services. Deployment needs the existing image build/push
and Container App update permissions. Rate-limit state remains in memory and
replica-local; the API template currently caps the API at one replica.

The proxy fix was deployed to the existing France Central API on
2026-10-07 using a scoped ACR remote build and a single Container App update
that set both the image and `TRUST_PROXY_HOPS=1`. This intentionally avoided
the project-wide AZD hooks, which also bootstrap SQL and update the worker.
Image tag: `proxytrust-20261007-0525`; active healthy revision:
`ca-dataingest-api-sbfracent--proxytrust-20261007-0525`.
Health returned HTTP 200, an unauthenticated protected API request with a
forwarded prefix returned the expected HTTP 401, and fresh revision logs
contained startup/Service Bus initialization without the forwarded-header
validation error. Authenticated workflows and live multi-client isolation
remain untested; no production limits were exhausted.

## Parameters and secrets

Create a local `azd` environment and set its subscription and region. For example,
in PowerShell:

```powershell
azd env new dev --subscription "<subscription-id>" --location "<region>"
azd env set AZURE_TENANT_ID "<tenant-id>"
azd env set SQL_ADMIN_OBJECT_ID "<operator-object-id>"
azd env set SQL_ADMIN_LOGIN "<operator-display-name>"
azd env set RULES_SERVICE_API_CLIENT_ID "<rules-api-client-id>"
azd env set RULES_SERVICE_API_AUDIENCE "api://<rules-api-client-id>"
azd env set RULES_SERVICE_API_ROLE_ID "<rules-api-app-role-id>"
azd env set MS_CLIENT_ID "<web-sso-client-id>"
azd env set MS_CLIENT_SECRET "<web-sso-client-secret>"
azd env set JWT_SECRET "<strong-random-secret>"
azd env set IMAGE_TAG "<immutable-image-tag>"
```

For a Foundry role assignment, also set `FOUNDRY_PROJECT_RESOURCE_ID`. Worker
capacity is configurable through `WORKER_CPU` and `WORKER_MEMORY` (defaults:
`2` vCPU and `4Gi`). `WORKLOAD_NAME` and `AZURE_ENV_NAME` control resource
naming. The Bicep parameter file contains placeholder defaults to make offline
compilation possible; replace required identity and secret values in the local
`azd` environment before a real deployment.

Keep this environment local and ignored by Git. Do not paste secrets into
terminal transcripts, source files, workflow logs, or `.env.example`. The
deployment writes the JWT secret, SSO client secret and Application Insights
connection string to Key Vault; Container Apps reference Key Vault secrets.
Runtime SQL, Blob and Service Bus access uses managed identities rather than
connection strings.

PRs run the `CI` workflow; merging to `main` runs CI again on the actual merged
commit. Deployment is intentionally a separate manual approval action:
dispatch `Deploy to Azure` from `main` only after that commit's CI succeeds.
The deployment workflow rejects other branches and commits whose latest main
push CI run is missing, pending or unsuccessful. Checking the PR alone is not
sufficient because the merge commit has a different SHA.

The GitHub Actions deployment workflow uses OIDC for both Azure CLI and azd.
Configure the `azure-deployment` GitHub environment to permit only `main`.
Required environment reviewers are not supported by this private repository's
current billing plan, so manual dispatch is the approval gate; do not add an
automatic merge trigger unless an equivalent approval gate is available.
Create a dedicated deployment app/service principal with a federated credential
whose issuer is `https://token.actions.githubusercontent.com`, audience is
`api://AzureADTokenExchange` and subject is
`repo:nabeelp/DataIngestionPlatform:environment:azure-deployment`.
Do not reuse application runtime identities or create a client secret.
Grant Contributor only on the existing resource group. azd environment refresh
also needs subscription deployment-history read access; use a narrow custom
role for that operation rather than subscription-wide Contributor.
Set the
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `AZURE_LOCATION`
GitHub environment variables. The workflow deploys to an already provisioned
`azd` environment; it does not provision infrastructure. Its `deployment_target`
input defaults to `all` for coordinated releases and supports:

- `validate`: Verify GitHub OIDC, both CLI logins, existing environment refresh
  and resource discovery without image builds, provisioning, SQL jobs or rollout.
  Run this first after merging and passing main CI to prove the identity setup.
- `frontend`: Build and deploy only the SPA image. Use this for frontend-only
  changes such as the admin user-management UI.
- `worker`: Build and update only the validation Container Apps Job image. It
  does not start an execution or modify Service Bus messages.
- `all`: Run `azd deploy` for the API, rules service and frontend, including
  the configured postdeploy SQL bootstrap and worker-image update hooks.

All targets use the workflow run's commit SHA as an immutable image tag. The
frontend and worker targets verify the existing managed identity's `AcrPull`
assignment before deployment and then verify the resulting image; the frontend
target also checks `/health`. For Bicep changes, review and approve a separate
`azd provision` after a what-if preview; selecting a deployment target never
applies infrastructure changes.

## Preview, provision and deploy

1. Review the parameters, region, allowed egress IPs, Entra registrations and
   cost drivers.
2. Run `az bicep build --file infra/main.bicep` and
   `az bicep build-params --file infra/main.bicepparam`.
3. Run `azd provision --preview --environment <environment>`. Review the
   planned resources and changes. Preview does not create Azure resources.
4. **Stop here and obtain explicit approval.** Only after approval, run
   `azd provision --environment <environment> --no-prompt`. This creates
   billable resources. The initial Container Apps revisions use a public
   placeholder image so provisioning does not depend on an image already being
   present in the new ACR. The postprovision hook configures API CORS and its
   callback URI, updates the SSO redirect URI, and grants the Rules API
   application role to the API identity.
5. Before deploying images, confirm the API, worker, SQL bootstrap and
    dedicated frontend managed identities have the expected `AcrPull` role on
    the registry. Allow time for role propagation; do not use `azd up`, which
    skips this gate.
6. Set an immutable `IMAGE_TAG`, then run
    `azd deploy --environment <environment> --no-prompt`. AZD uses ACR remote
    builds for the API, validation-service and frontend Dockerfiles with that
    tag. The predeploy hook checks the provisioned HTTPS URLs; the frontend
    image reads its API URL at runtime. The postdeploy hook temporarily promotes
    the dedicated bootstrap identity to SQL Entra administrator, starts the
    private-network schema/grant job, restores the configured administrator
    even if the job fails, and updates the validation worker job to the built
    validation-service image.

The repository workflow is manual after merged-main CI succeeds; use `all` for
a coordinated application deployment or a targeted frontend/worker deployment
to avoid unrelated updates.
Infrastructure provisioning remains a separate, explicitly approved step.

## Post-deployment checks

### Resetting a disposable environment while retaining users

Use an in-place reset when the deployed database already has JSON
`FileDefinitions.Contract`, `Rules.Config` and `Uploads.BlobContainer`.
The current scripts add `FileDefinitionVersions.DefinitionMetadata` and remove
four obsolete upload columns; that does not require deleting the database.
An older incompatible schema requires a separate reviewed procedure, never an
automatic database replacement.

The reset removes every non-user application row and all live objects in
`uploads`, `reports`, `templates`, `staging` and `deliveries`. It preserves
every persisted Users field, SQL managed-identity principals, containers,
secrets and retention policies. Soft-deleted blobs, SQL backups and operational
logs remain subject to existing platform retention. There is no business-data
rollback unless a separate backup/restore procedure was explicitly arranged.

Before execution, obtain explicit deletion and deployment approval, ensure
there are no users or active jobs, and verify every queue/subscription message
counter is zero. The preparation script refuses non-empty messaging: it does
not silently discard pending, scheduled or dead-letter work. It also refuses
unexpected tables, foreign-key dependencies, or a changed user count.

Build the approved API image in the existing ACR with a new, never-reused
`IMAGE_TAG` **before** deleting data. The same release must be deployed
afterwards. Use the staged image through the existing private-network bootstrap
job to inspect the exact reset inventory:

```powershell
pwsh -NoProfile -File scripts/postdeploy.ps1 -Prepare `
  -ConfirmEnvironment sbfracent -ExpectedUsers 2 `
  -BootstrapImage "<acr-login-server>/<api-repository>:<IMAGE_TAG>"
```

Preparation defaults to inspection. It temporarily grants the bootstrap
identity container-scoped Blob Data Reader, temporarily switches the SQL
administrator and runs a one-shot job. Review that execution's sanitized
table/blob count logs; no user records are exported. Use the current observed
user count, not an assumed constant.

Only after reviewing the inventory and confirming deletion, repeat the command
with **`-ExecuteReset`**. This uses temporary container-scoped Blob Data
Contributor. SQL row deletion and compatible schema updates run transactionally
with a byte-for-byte user comparison; Blob deletion is a separate, explicitly
verified phase. A partial blob failure is reported and requires a reviewed
rerun. Temporary role assignments, job retry settings and the actual previous
SQL administrator are restored on success or failure. Reset arguments are
execution overrides, never persistent job settings. Preparation copies the
existing full execution template into a temporary JSON/YAML input to retain
environment variables, resources and container names; Azure CLI's individual
image/argument flags replace rather than merge the container. The temporary
file is removed during cleanup. Retry-limit changes are read back because
some CLI versions ignore a numeric zero passed through the job update flag.

Next reconcile missing telemetry without reprovisioning:

```powershell
pwsh -NoProfile -File scripts/sync-telemetry.ps1 -ConfirmEnvironment sbfracent
# After reviewing the target and approving configuration changes:
pwsh -NoProfile -File scripts/sync-telemetry.ps1 -ConfirmEnvironment sbfracent -Execute
azd deploy --all --environment sbfracent --no-prompt
```

The telemetry helper restores the documented full-development sampling
settings; review ingestion costs before execution. It adds only monitoring
settings and preserves Foundry model overrides, CORS, callbacks, identities
and other runtime settings. Do not run blanket `azd provision` merely to repair
telemetry: provisioning uses placeholder images and does not model all manual
runtime overrides. In particular, preserve the intended `AZURE_FOUNDRY_MODEL`
instead of unintentionally reverting to the code default.

Normal postdeploy remains non-destructive: it reapplies idempotent schema and
managed-identity grants and updates the worker image. Preparing the schema
**before** rollout avoids starting the new API without its metadata column.
Deploy the API, Python rules API, frontend and worker together when shared
contracts change; frontend-only and worker-only deployments are insufficient.

The manual GitHub workflow is an alternative after the complete feature branch
is published, CI passes, and the `azure-deployment` environment/OIDC identity
is configured. A PR or merge alone does not deploy. Perform the same separately
approved reset preparation before dispatching `deployment_target=all`; never
attach destructive reset to an automatic PR/push trigger.

Capture prior image digests/configuration before rollout. Old tags may have
been overwritten, and old binaries may still query columns removed by this
release; do not assume image-only rollback is schema-compatible. Verify retained
users, authentication, definition publication, representative synthetic
uploads, reports, delivery/replay and telemetry. Remove acceptance-test data
and verify the final intended empty state before handoff.

- Check `API_URL` (which must end in `/api/v1`) and `FRONTEND_URL` outputs;
  verify both Container Apps health endpoints and open the frontend.
- Confirm the frontend runtime configuration points to the API URL, API CORS
  allows only the frontend origin, and the Entra callback matches
  `FRONTEND_URL/auth/callback`.
- Confirm unauthenticated requests to the rules-service receive HTTP 401 and
  that only the API managed identity can obtain an accepted token.
- Verify the SQL schema and API/worker contained users; check the API and worker
  use managed identity rather than SQL passwords.
- Upload a representative sample through the UI. Confirm status, validation
  counts, issue details, report download, Service Bus delivery and worker logs.
- Check Blob Storage private endpoint resolution and Entra-only Service Bus
  connectivity from the API and worker,
  Key Vault references, Container Apps health and Log Analytics diagnostics.
- Review failed messages and dead-letter counts before enabling production
  traffic. Never log uploaded cell values, file contents, tokens or secrets.

## Application Insights telemetry

Container Apps console/system logs and application telemetry are separate
pipelines. Console output appears in `ContainerAppConsoleLogs_CL` in the
Log Analytics workspace; it does not automatically become Application Insights
requests, dependencies, exceptions, or traces.

The application initializes Azure Monitor OpenTelemetry before loading the
Node API and Python rules API. Node instruments HTTP, Express route templates,
native `fetch`, Azure SDK clients, the Azure SQL Tedious driver, and Winston.
The Python worker also exports its existing validation-stage spans and
`dq.rows_per_second` metric. Worker exit and API shutdown flush exporters with
bounded timeouts; flush failures are reported rather than silently discarded.
The LocalDB native driver is not instrumented by Tedious.

| Workload | Application Insights role | Configuration |
|---|---|---|
| Node API | `data-ingestion-api` | Key Vault-backed `APPLICATIONINSIGHTS_CONNECTION_STRING` |
| Python rules API | `data-ingestion-rules` | Key Vault-backed connection string; SDK initialized before FastAPI loads |
| Validation worker | `data-ingestion-worker` | Key Vault-backed connection string; final trace/log/metric flush before job exit |
| React browser | `data-ingestion-web` | Public routing configuration generated in the frontend's runtime config |

Leaving the connection string unset disables telemetry locally without changing
application behavior. A configured SDK that fails to initialize is reported
explicitly. `OTEL_SERVICE_NAME` identifies server roles. Server trace sampling
defaults to `APPLICATIONINSIGHTS_SAMPLING_RATIO=1` (full development capture);
set a value from `0` to `1` in the azd environment before provisioning to reduce
production ingestion. Sampling is not a guarantee of a fixed monthly cost:
logs, metrics, traffic volume, retention, and browser telemetry also contribute.
Browser sampling defaults to `APPLICATIONINSIGHTS_BROWSER_SAMPLING_PERCENTAGE=100`
so development verification is not hidden by session sampling. Set a percentage
greater than `0` and at most `100` (for example, `10` for production) in the azd
environment before provisioning. The frontend reads it as the runtime field
`applicationInsightsSamplingPercentage`; the connection string field is
`applicationInsightsConnectionString`.

Browser telemetry uses the Application Insights JavaScript SDK, not server-side
OpenTelemetry. Its routing connection string is intentionally visible to the
browser and is not an authorization credential. Bicep supplies it directly from
the monitoring component; the frontend identity still has only `AcrPull` and
does not gain Key Vault or data permissions. Never place JWT, Entra, SQL,
Storage, or other credentials in browser runtime configuration.

Telemetry processors omit raw URL query strings, SQL text, model inputs/outputs,
and uploaded-file payloads. Exported Node logs retain severity and allowlisted
categories, not arbitrary raw message text or error stacks; detailed existing
console logs remain in Log Analytics and require the same access/retention
controls as before. Browser route and exception telemetry is sanitized to avoid
authentication codes, query strings, dynamic IDs, document titles, and raw
exception messages. Standard HTTP trace headers correlate supported browser/API
and API/rules-service calls; custom Service Bus worker spans do not by themselves
guarantee an end-to-end HTTP-to-queue trace.

### Applying and verifying telemetry changes

Code changes require rebuilding and deploying all affected images. **An image
deployment alone does not apply Bicep changes:** review the provision preview
and obtain approval before applying the new frontend runtime setting, server
role names, or sampling configuration. Provisioning preserves the existing
monitoring resources; no new monitoring service is needed.

After the approved deployment:

1. Check console startup diagnostics for telemetry enabled/disabled and SDK or
   flush failures, without printing connection strings.
2. Open the SPA, navigate between routes, issue an authenticated API call that
   reaches the rules service, and validate an approved non-sensitive sample.
3. Allow several minutes for ingestion, then run this query in the **Application
   Insights** Logs scope:

   ```kusto
   union withsource=TelemetryTable
       requests, dependencies, exceptions, traces, customMetrics, pageViews
   | where timestamp > ago(30m)
   | summarize Items=count() by TelemetryTable, cloud_RoleName
   | order by cloud_RoleName asc, TelemetryTable asc
   ```

4. Confirm requests and traces for both APIs, browser page views, worker
   dependencies/stage spans and `dq.rows_per_second` in `customMetrics`.
   Exceptions require a controlled failure; empty exception tables alone are
   not an ingestion problem.
5. Inspect a representative transaction's `operation_Id` across requests and
   dependencies. Check that exported telemetry has no raw query strings,
   authorization headers, SQL/model content, cell values, or exception payloads.

In workspace Logs scope, use the corresponding `AppRequests`, `AppDependencies`,
`AppExceptions`, `AppTraces`, `AppMetrics`, and `AppPageViews` tables with
`TimeGenerated` and `AppRoleName`. For production, review sampling and retention,
restrict workspace access, and alert on export failures or missing telemetry
while application traffic is present.

## Cost and teardown

The main cost drivers are the always-on API replica, frontend Container Apps
requests and replica execution time, Container Apps worker vCPU/memory
execution time, Azure SQL serverless compute (0.5 minimum vCore
while active, up to 2 vCores) and storage, Service Bus Standard, three private
endpoint hours, ACR storage, Log Analytics ingestion/retention, and network
egress. The SQL database is configured to auto-pause after 60 minutes, but its
actual billed compute depends on active workload. There is no reliable fixed
monthly estimate without expected active hours, database storage, file/queue
volume, and log ingestion; review the fresh France Central deployment preview
and Azure Pricing Calculator, accounting for any contract discounts. The
minimum-one API replica and 30-day Log Analytics retention mean this is not a
zero-cost sandbox.

`azd down` or deleting the resource group removes deployed resources and may
permanently delete uploaded files, reports, database contents and secrets.
Review backups and obtain explicit approval before teardown.
