# Azure deployment

The repository contains an `azd`/Bicep deployment for the API, Python validation
service and worker, plus Azure SQL, Blob Storage, Service Bus, Key Vault,
Container Registry, monitoring, networking and Static Web Apps. The template and
`azd provision --preview` have been validated. No Azure resources have been
provisioned by this work; obtain explicit owner approval before running
`azd provision`, `azd up`, or a deployment workflow.

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
  profiles, Azure SQL serverless, Service Bus Standard and Static Web Apps.
- Azure CLI, Azure Developer CLI (`azd`), Bicep, Docker, Node.js 24, `uv`,
  PowerShell 7 (`pwsh`) and the Go `sqlcmd` utility.
- A signed-in deployment operator. The operator needs permission to create the
  listed resource types and assign RBAC roles. Use **Owner** or **Contributor**
  plus **User Access Administrator** at the resource-group scope. A narrower,
  approved custom role may be used if it includes all required actions.
- Permission to create and configure Microsoft Entra app registrations, or an
  Entra administrator to complete those steps and grant consent.
- An existing Microsoft Entra SSO app registration for the web API, and a
  dedicated single-tenant app registration representing the rules-service API.
- For the optional Foundry role assignment, the existing Foundry project
  resource ID and permission to assign **Azure AI User** on that project.

Configure the rules-service API registration with an Application ID URI and an
application permission for the API identity. After provisioning, grant the
required application permission/consent to the API's user-assigned managed
identity. The Container Apps auth policy also limits accepted audiences and
client applications to this API. The workflow does not create or grant Entra
permissions.

## Managed identity permissions

The RBAC module scopes data-plane access to individual containers and messaging
entities wherever Azure supports it:

| Identity | Scope and role |
|---|---|
| API | Blob Data Contributor on `uploads`, `reports`, and `templates`; Service Bus Data Sender on `validation-requests`, Data Receiver on the `validation-events/api` subscription, and Sender/Receiver on `delivery-requests`; Key Vault Secrets User; ACR Pull; Azure AI User on the optional existing Foundry project |
| Worker / rules-service | Blob Data Reader on `uploads`, Blob Data Contributor on `reports` and `staging`; Service Bus Data Receiver on `validation-requests` and Data Sender on `validation-events`; Key Vault Secrets User for its monitoring secret; ACR Pull |
| API and worker | SQL contained users with `db_datareader` and `db_datawriter`, created by the postprovision hook |

The API has Blob Data Contributor on `reports` because the existing upload
cleanup route deletes its persisted report using the API identity. This role is
limited to the reports container; the worker writes the reports.

## Networking and authentication decisions

- SQL, Blob Storage and Key Vault use private endpoints and private DNS from the
  Container Apps VNet. SQL uses Entra-only authentication; the SQL bootstrap
  password is a server-creation parameter, not the runtime credential.
- Service Bus uses Standard because Private Link requires Premium. Local/SAS
  authentication is disabled, and its public endpoint uses a default-deny IP
  firewall allowing the Container Apps environment's reported outbound IPs.
- ACR uses Basic because Private Link is unavailable at that tier. Its admin
  account is disabled; Container Apps pull images using managed identities.
- The API and Static Web App are externally reachable. The rules-service is also
  externally reachable but requires Container Apps built-in Entra authentication
  and allows only the API managed identity and configured audience. This is an
  intentional, owner-selected deviation from the plan's internal-ingress
  preference: Microsoft documents Container Apps built-in auth for
  external-ingress apps. The endpoint is not anonymous, but it has a public
  address; preserve the issuer, audience, allowed-application and 401 settings.
  If policy requires a private-only endpoint, change to service-level bearer
  token validation before removing the external ingress.
- The Static Web App calls the API directly using the API URL injected at build
  time. The API uses managed identity for SQL, Blob Storage, Service Bus,
  Key Vault and the rules-service token.

## Parameters and secrets

Create a local `azd` environment and set its subscription and region. For example,
in PowerShell:

```powershell
azd env new dev --subscription "<subscription-id>" --location "<region>"
azd env set AZURE_TENANT_ID "<tenant-id>"
azd env set SQL_ADMIN_OBJECT_ID "<operator-object-id>"
azd env set SQL_ADMIN_LOGIN "<operator-display-name>"
azd env set SQL_BOOTSTRAP_PASSWORD "<strong-random-password>"
azd env set RULES_SERVICE_API_CLIENT_ID "<rules-api-client-id>"
azd env set RULES_SERVICE_API_AUDIENCE "api://<rules-api-client-id>"
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
`azd` environment; it does not provision infrastructure.

## Preview, provision and deploy

1. Review the parameters, region, allowed egress IPs, Entra registrations and
   cost drivers.
2. Run `az bicep build --file infra/main.bicep` and
   `az bicep build-params --file infra/main.bicepparam`.
3. Run `azd provision --preview --environment dev`. Review the planned resources
   and changes. Preview does not create Azure resources.
4. **Stop here and obtain explicit approval.** Only after approval, run
   `azd provision --environment dev`. This creates billable resources.
5. Ensure the Entra application permission has been granted to the API managed
   identity, then run `azd deploy --environment dev`. The predeploy hook builds
   and pushes images, builds the frontend with the API URL, and updates the
   worker job image. The postprovision hook applies the SQL schema and grants
   contained database roles using Entra authentication.

The repository workflow is manual and runs `azd deploy`; infrastructure
provisioning remains a separate, explicitly approved step.

## Post-deployment checks

- Check `API_URL` and `STATIC_WEB_APP_URL` outputs; verify the API health endpoint
  and open the Static Web App.
- Confirm unauthenticated requests to the rules-service receive HTTP 401 and
  that only the API managed identity can obtain an accepted token.
- Verify the SQL schema and API/worker contained users; check the API and worker
  use managed identity rather than SQL passwords.
- Upload a representative sample through the UI. Confirm status, validation
  counts, issue details, report download, Service Bus delivery and worker logs.
- Check Blob Storage private endpoint resolution, Service Bus firewall access,
  Key Vault references, Container Apps health and Log Analytics diagnostics.
- Review failed messages and dead-letter counts before enabling production
  traffic. Never log uploaded cell values, file contents, tokens or secrets.

## Cost and teardown

The main cost drivers are the always-on API replica, Container Apps worker
vCPU/memory execution time, Azure SQL serverless vCore-seconds and storage,
Service Bus Standard's base fee, ACR storage, Static Web Apps plan, and
Log Analytics ingestion/retention, private endpoint hours and network egress.
Estimate using the Azure Pricing Calculator for the chosen region and expected
hours, file sizes, queue volume and log volume. The configured one-replica API
and Log Analytics retention mean the deployment is not a zero-cost sandbox.

`azd down` or deleting the resource group removes deployed resources and may
permanently delete uploaded files, reports, database contents and secrets.
Review backups and obtain explicit approval before teardown.
