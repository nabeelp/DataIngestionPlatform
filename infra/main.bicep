targetScope = 'resourceGroup'

@description('Workload name used in resource names.')
@minLength(3)
@maxLength(12)
param workloadName string = 'dataingest'

@description('Deployment environment name.')
@minLength(2)
@maxLength(10)
param environmentName string = 'dev'

@description('Azure region for regional resources.')
param location string = resourceGroup().location

@description('Azure tenant ID.')
param tenantId string

@description('Object ID of the SQL Entra administrator.')
param sqlAdminObjectId string

@description('Display name of the SQL Entra administrator.')
param sqlAdminLogin string

@description('Client ID of the dedicated rules-service Entra API registration.')
param rulesServiceApiClientId string

@description('Application ID URI/audience of the rules-service Entra API registration.')
param rulesServiceApiAudience string

@description('Client ID of the existing Entra SSO application used by the web API.')
param ssoClientId string

@description('Customer-supplied Citadel APIM base URL exposing the Responses API (no default).')
param citadelEndpoint string

@description('HTTP header carrying the Citadel APIM subscription key.')
param citadelSubscriptionKeyHeader string = 'api-key'

@description('Citadel model deployment name.')
param citadelModel string = 'gpt-6-luna'

@description('Citadel APIM subscription key written to Key Vault when supplied.')
@secure()
param citadelSubscriptionKey string = ''

@description('CPU cores allocated to each validation worker execution.')
param workerCpu int = 2

@description('Memory allocated to each validation worker execution.')
param workerMemory string = '4Gi'

@description('Fraction of server traces to retain, from 0 to 1. Defaults to full capture for development.')
param telemetrySamplingRatio string = '1'

@description('Percentage of browser telemetry to retain, greater than 0 and at most 100. Defaults to full development capture.')
param telemetryBrowserSamplingPercentage string = '100'

@description('JWT signing secret written to Key Vault.')
@secure()
param jwtSecret string = ''

@description('Entra SSO client secret written to Key Vault.')
@secure()
param msClientSecret string = ''

@description('Tags applied to all created resources.')
param additionalTags object = {}

@description('VNet address range.')
param vnetAddressPrefix string = '10.42.0.0/16'

@description('Dedicated Container Apps workload-profile subnet.')
param containerAppsSubnetPrefix string = '10.42.0.0/27'

@description('Dedicated private endpoint subnet.')
param privateEndpointSubnetPrefix string = '10.42.1.0/27'

var suffix = uniqueString(subscription().id, resourceGroup().id, environmentName)
var normalizedWorkloadName = toLower(replace(workloadName, '-', ''))
var tags = union({
  Application: 'DataIngestionPlatform'
  Environment: environmentName
  ManagedBy: 'azd'
}, additionalTags)
var names = {
  virtualNetwork: 'vnet-${workloadName}-${environmentName}'
  containerAppsEnvironment: 'cae-${workloadName}-${environmentName}'
  apiContainerApp: 'ca-${workloadName}-api-${environmentName}'
  rulesServiceContainerApp: 'ca-${workloadName}-rules-${environmentName}'
  frontendContainerApp: 'ca-${workloadName}-frontend-${environmentName}'
  workerJob: 'job-${workloadName}-worker-${environmentName}'
  storageAccount: take(toLower('st${normalizedWorkloadName}${suffix}'), 24)
  keyVault: take('kv-${take(normalizedWorkloadName, 8)}-${suffix}', 24)
  sqlServer: 'sql-${take(normalizedWorkloadName, 8)}-${suffix}'
  sqlDatabase: 'DataIngestion'
  serviceBus: 'sb-${take(normalizedWorkloadName, 8)}-${suffix}'
  registry: take(toLower(replace('cr${normalizedWorkloadName}${suffix}', '-', '')), 50)
  logAnalytics: 'log-${workloadName}-${environmentName}'
  appInsights: 'appi-${workloadName}-${environmentName}'
  apiIdentity: 'id-${workloadName}-api-${environmentName}'
  workerIdentity: 'id-${workloadName}-worker-${environmentName}'
  sqlBootstrapIdentity: 'id-${workloadName}-sql-bootstrap-${environmentName}'
  frontendIdentity: 'id-${workloadName}-frontend-${environmentName}'
  sqlBootstrapJob: 'job-${workloadName}-sqlb-${environmentName}'
}

module network './modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    virtualNetworkName: names.virtualNetwork
    addressPrefix: vnetAddressPrefix
    containerAppsSubnetPrefix: containerAppsSubnetPrefix
    privateEndpointSubnetPrefix: privateEndpointSubnetPrefix
    tags: tags
  }
}

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    workspaceName: names.logAnalytics
    appInsightsName: names.appInsights
    tags: tags
  }
}

module identities './modules/identities.bicep' = {
  name: 'identities'
  params: {
    location: location
    apiIdentityName: names.apiIdentity
    workerIdentityName: names.workerIdentity
    sqlBootstrapIdentityName: names.sqlBootstrapIdentity
    frontendIdentityName: names.frontendIdentity
    tags: tags
  }
}

module registry './modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    registryName: names.registry
    tags: tags
  }
}

module messaging './modules/messaging.bicep' = {
  name: 'messaging'
  params: {
    location: location
    namespaceName: names.serviceBus
    tags: tags
  }
}

module data './modules/data.bicep' = {
  name: 'data'
  params: {
    location: location
    storageAccountName: names.storageAccount
    keyVaultName: names.keyVault
    sqlServerName: names.sqlServer
    sqlDatabaseName: names.sqlDatabase
    tenantId: tenantId
    sqlAdminObjectId: sqlAdminObjectId
    sqlAdminLogin: sqlAdminLogin
    jwtSecret: jwtSecret
    msClientSecret: msClientSecret
    citadelSubscriptionKey: citadelSubscriptionKey
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    privateEndpointSubnetId: network.outputs.privateEndpointSubnetId
    blobPrivateDnsZoneId: network.outputs.blobPrivateDnsZoneId
    sqlPrivateDnsZoneId: network.outputs.sqlPrivateDnsZoneId
    keyVaultPrivateDnsZoneId: network.outputs.keyVaultPrivateDnsZoneId
    tags: tags
  }
}

module rbac './modules/rbac.bicep' = {
  name: 'rbac'
  params: {
    apiPrincipalId: identities.outputs.apiPrincipalId
    workerPrincipalId: identities.outputs.workerPrincipalId
    sqlBootstrapPrincipalId: identities.outputs.sqlBootstrapPrincipalId
    frontendPrincipalId: identities.outputs.frontendPrincipalId
    storageAccountName: data.outputs.storageAccountName
    keyVaultName: data.outputs.keyVaultName
    registryName: registry.outputs.registryName
    serviceBusNamespaceName: messaging.outputs.namespaceName
  }
}

module apps './modules/apps.bicep' = {
  name: 'apps'
  params: {
    location: location
    environmentName: names.containerAppsEnvironment
    apiContainerAppName: names.apiContainerApp
    rulesServiceContainerAppName: names.rulesServiceContainerApp
    frontendContainerAppName: names.frontendContainerApp
    workerJobName: names.workerJob
    sqlBootstrapJobName: names.sqlBootstrapJob
    registryLoginServer: registry.outputs.loginServer
    workerCpu: workerCpu
    workerMemory: workerMemory
    apiIdentityId: identities.outputs.apiIdentityId
    apiClientId: identities.outputs.apiClientId
    apiPrincipalId: identities.outputs.apiPrincipalId
    workerIdentityId: identities.outputs.workerIdentityId
    workerClientId: identities.outputs.workerClientId
    apiIdentityName: names.apiIdentity
    workerIdentityName: names.workerIdentity
    sqlBootstrapIdentityId: identities.outputs.sqlBootstrapIdentityId
    sqlBootstrapClientId: identities.outputs.sqlBootstrapClientId
    frontendIdentityId: identities.outputs.frontendIdentityId
    containerAppsSubnetId: network.outputs.containerAppsSubnetId
    logAnalyticsCustomerId: monitoring.outputs.logAnalyticsCustomerId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    telemetrySamplingRatio: telemetrySamplingRatio
    telemetryBrowserSamplingPercentage: telemetryBrowserSamplingPercentage
    storageAccountUrl: data.outputs.storageAccountUrl
    sqlServerName: data.outputs.sqlServerName
    sqlDatabaseName: data.outputs.sqlDatabaseName
    keyVaultUri: data.outputs.keyVaultUri
    serviceBusNamespace: messaging.outputs.fullyQualifiedNamespace
    serviceBusNamespaceName: messaging.outputs.namespaceName
    tenantId: tenantId
    ssoClientId: ssoClientId
    rulesServiceApiClientId: rulesServiceApiClientId
    rulesServiceApiAudience: rulesServiceApiAudience
    citadelEndpoint: citadelEndpoint
    citadelSubscriptionKeyHeader: citadelSubscriptionKeyHeader
    citadelModel: citadelModel
    tags: tags
  }
  dependsOn: [
    rbac
  ]
}

module serviceBusNetworkAccess './modules/servicebus-network-access.bicep' = {
  name: 'servicebus-network-access'
  params: {
    namespaceName: messaging.outputs.namespaceName
  }
}

output API_URL string = apps.outputs.apiUrl
output AZURE_RESOURCE_GROUP string = resourceGroup().name
output API_CONTAINER_APP_NAME string = apps.outputs.apiContainerAppName
output FRONTEND_CONTAINER_APP_NAME string = apps.outputs.frontendContainerAppName
output FRONTEND_URL string = apps.outputs.frontendUrl
output RULES_SERVICE_URL string = apps.outputs.rulesServiceUrl
output RULES_SERVICE_CONTAINER_APP_NAME string = apps.outputs.rulesServiceContainerAppName
output WORKER_JOB_NAME string = apps.outputs.workerJobName
output SQL_BOOTSTRAP_JOB_NAME string = apps.outputs.sqlBootstrapJobName
output CONTAINER_APPS_ENVIRONMENT_NAME string = names.containerAppsEnvironment
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.registryName
output ACR_LOGIN_SERVER string = registry.outputs.loginServer
output AZURE_STORAGE_ACCOUNT_NAME string = data.outputs.storageAccountName
output AZURE_STORAGE_ACCOUNT_URL string = data.outputs.storageAccountUrl
output SQL_SERVER_NAME string = data.outputs.sqlServerName
output SQL_DATABASE_NAME string = data.outputs.sqlDatabaseName
output KEY_VAULT_NAME string = data.outputs.keyVaultName
output LOG_ANALYTICS_WORKSPACE_ID string = monitoring.outputs.logAnalyticsWorkspaceId
output API_IDENTITY_NAME string = names.apiIdentity
output API_IDENTITY_PRINCIPAL_ID string = identities.outputs.apiPrincipalId
output WORKER_IDENTITY_NAME string = names.workerIdentity
output WORKER_IDENTITY_PRINCIPAL_ID string = identities.outputs.workerPrincipalId
output SQL_BOOTSTRAP_IDENTITY_NAME string = names.sqlBootstrapIdentity
output SQL_BOOTSTRAP_IDENTITY_PRINCIPAL_ID string = identities.outputs.sqlBootstrapPrincipalId
output FRONTEND_IDENTITY_PRINCIPAL_ID string = identities.outputs.frontendPrincipalId
