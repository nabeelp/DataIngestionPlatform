targetScope = 'resourceGroup'

@description('API managed identity principal ID.')
param apiPrincipalId string

@description('Worker managed identity principal ID.')
param workerPrincipalId string

@description('Temporary SQL bootstrap managed identity principal ID.')
param sqlBootstrapPrincipalId string

@description('Frontend managed identity principal ID.')
param frontendPrincipalId string

@description('Storage account name.')
param storageAccountName string

@description('Key Vault name.')
param keyVaultName string

@description('Container Registry name.')
param registryName string

@description('Service Bus namespace name.')
param serviceBusNamespaceName string

var blobDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var blobDataReaderRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var serviceBusSenderRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')
var serviceBusReceiverRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0')

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: storageAccountName
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' existing = {
  parent: storageAccount
  name: 'default'
}

resource uploads 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' existing = {
  parent: blobService
  name: 'uploads'
}

resource reports 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' existing = {
  parent: blobService
  name: 'reports'
}

resource staging 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' existing = {
  parent: blobService
  name: 'staging'
}

resource templates 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' existing = {
  parent: blobService
  name: 'templates'
}

resource deliveries 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' existing = {
  parent: blobService
  name: 'deliveries'
}

resource keyVault 'Microsoft.KeyVault/vaults@2026-02-01' existing = {
  name: keyVaultName
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: registryName
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2026-01-01' existing = {
  name: serviceBusNamespaceName
}

resource validationRequests 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' existing = {
  parent: serviceBus
  name: 'validation-requests'
}

resource deliveryRequests 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' existing = {
  parent: serviceBus
  name: 'delivery-requests'
}

resource validationEvents 'Microsoft.ServiceBus/namespaces/topics@2024-01-01' existing = {
  parent: serviceBus
  name: 'validation-events'
}

resource apiSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' existing = {
  parent: validationEvents
  name: 'api'
}

resource apiUploadsContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uploads.id, apiPrincipalId, blobDataContributorRoleId)
  scope: uploads
  properties: {
    roleDefinitionId: blobDataContributorRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiReportsContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(reports.id, apiPrincipalId, blobDataContributorRoleId)
  scope: reports
  properties: {
    roleDefinitionId: blobDataContributorRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiTemplatesContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(templates.id, apiPrincipalId, blobDataContributorRoleId)
  scope: templates
  properties: {
    roleDefinitionId: blobDataContributorRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiDeliveriesContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(deliveries.id, apiPrincipalId, blobDataContributorRoleId)
  scope: deliveries
  properties: {
    roleDefinitionId: blobDataContributorRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource workerUploadsReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uploads.id, workerPrincipalId, blobDataReaderRoleId)
  scope: uploads
  properties: {
    roleDefinitionId: blobDataReaderRoleId
    principalId: workerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource workerReportsContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(reports.id, workerPrincipalId, blobDataContributorRoleId)
  scope: reports
  properties: {
    roleDefinitionId: blobDataContributorRoleId
    principalId: workerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource workerStagingContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(staging.id, workerPrincipalId, blobDataContributorRoleId)
  scope: staging
  properties: {
    roleDefinitionId: blobDataContributorRoleId
    principalId: workerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource workerKeyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, workerPrincipalId, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRoleId
    principalId: workerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiKeyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, apiPrincipalId, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, apiPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource workerAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, workerPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: workerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource sqlBootstrapAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, sqlBootstrapPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: sqlBootstrapPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource frontendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, frontendPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: frontendPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiValidationSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(validationRequests.id, apiPrincipalId, serviceBusSenderRoleId)
  scope: validationRequests
  properties: {
    roleDefinitionId: serviceBusSenderRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiEventsReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(apiSubscription.id, apiPrincipalId, serviceBusReceiverRoleId)
  scope: apiSubscription
  properties: {
    roleDefinitionId: serviceBusReceiverRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiDeliverySender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(deliveryRequests.id, apiPrincipalId, serviceBusSenderRoleId)
  scope: deliveryRequests
  properties: {
    roleDefinitionId: serviceBusSenderRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource apiDeliveryReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(deliveryRequests.id, apiPrincipalId, serviceBusReceiverRoleId)
  scope: deliveryRequests
  properties: {
    roleDefinitionId: serviceBusReceiverRoleId
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource workerValidationReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(validationRequests.id, workerPrincipalId, serviceBusReceiverRoleId)
  scope: validationRequests
  properties: {
    roleDefinitionId: serviceBusReceiverRoleId
    principalId: workerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource workerEventsSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(validationEvents.id, workerPrincipalId, serviceBusSenderRoleId)
  scope: validationEvents
  properties: {
    roleDefinitionId: serviceBusSenderRoleId
    principalId: workerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output rbacReady bool = true
