# Azure deployment

The repository contains an `azd`/Bicep deployment for the API, React SPA,
Python validation service and worker, plus Azure SQL, Blob Storage, Service
Bus, Key Vault, Container Registry, monitoring and private networking.
Provisioning attempts in East US 2 and Central US failed on regional SQL and
Container Apps capacity, respectively. The deployed target is France Central,
with the frontend hosted in Container Apps because Azure Static Web Apps is not
listed there. Provider metadata and quota retrieval do not guarantee live
capacity; the successful deployment is recorded below.

The prior groups were inspected after the user reported cleaning them up:
East US 2 was absent and Central US was still deleting with the failed
Container Apps environment present. Soft-deleted Key Vaults remain in the
prior regions. No purge was performed. France Central is provisioned and hosts
the deployed API, frontend, and rules service. The frontend uses an HTTP
concurrency scale rule and scales from zero to two replicas.

The latest deployment check returned HTTP 200 from the frontend health, root,
and runtime-config routes and the API health route. The rules service requires
Entra authentication. SQL bootstrap succeeded and restored the configured SQL
administrator. Authenticated OPS-01 cloud workflow acceptance (delivery,
replay, owner-authorized download, and deletion) remains pending a test identity
and test data.

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
  profiles, Azure SQL serverless and Service Bus Standard. France Central does
  not offer the Static Web Apps resource used by the previous design.
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

The GitHub Actions deployment workflow uses OIDC. Configure the `azure-deployment`
GitHub environment with required reviewers if deployment approval is needed,
then create federated credentials for the workflow identity. Set the
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `AZURE_LOCATION`
GitHub environment variables. The workflow deploys to an already provisioned
`azd` environment; it does not provision infrastructure. Its `deployment_target`
input supports:

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

The repository workflow is manual; use `all` for a coordinated application
deployment or a targeted frontend/worker deployment to avoid unrelated updates.
Infrastructure provisioning remains a separate, explicitly approved step.

## Post-deployment checks

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
