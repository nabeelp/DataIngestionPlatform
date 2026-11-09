targetScope = 'resourceGroup'

@description('Azure region for data services.')
param location string

@description('Globally unique Storage account name.')
param storageAccountName string

@description('Globally unique Key Vault name.')
param keyVaultName string

@description('Globally unique Azure SQL logical server name.')
param sqlServerName string

@description('Azure SQL database name.')
param sqlDatabaseName string

@description('Microsoft Entra tenant ID.')
param tenantId string

@description('Object ID for the Microsoft Entra SQL administrator.')
param sqlAdminObjectId string

@description('Login/display name for the Microsoft Entra SQL administrator.')
param sqlAdminLogin string

@secure()
@description('JWT signing secret written to Key Vault when supplied.')
param jwtSecret string

@secure()
@description('Entra SSO client secret written to Key Vault when supplied.')
param msClientSecret string

@secure()
@description('Citadel APIM subscription key written to Key Vault when supplied.')
param citadelSubscriptionKey string

@description('Application Insights connection string written to Key Vault.')
param appInsightsConnectionString string

@description('Private endpoint subnet resource ID.')
param privateEndpointSubnetId string

@description('Blob private DNS zone resource ID.')
param blobPrivateDnsZoneId string

@description('SQL private DNS zone resource ID.')
param sqlPrivateDnsZoneId string

@description('Key Vault private DNS zone resource ID.')
param keyVaultPrivateDnsZoneId string

@description('Tags applied to resources.')
param tags object

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Deny'
      ipRules: []
      virtualNetworkRules: []
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource uploadsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'uploads'
  properties: {
    publicAccess: 'None'
  }
}

resource reportsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'reports'
  properties: {
    publicAccess: 'None'
  }
}

resource stagingContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'staging'
  properties: {
    publicAccess: 'None'
  }
}

resource templatesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'templates'
  properties: {
    publicAccess: 'None'
  }
}

resource deliveriesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'deliveries'
  properties: {
    publicAccess: 'None'
  }
}

resource stagingLifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          enabled: true
          name: 'delete-staging-after-30-days'
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'staging/'
              ]
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 30
                }
              }
            }
          }
        }
      ]
    }
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2026-02-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Deny'
      ipRules: []
      virtualNetworkRules: []
    }
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource citadelKeyVaultSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = if (!empty(citadelSubscriptionKey)) {
  parent: keyVault
  name: 'citadel-subscription-key'
  properties: {
    value: citadelSubscriptionKey
  }
}

resource jwtKeyVaultSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = if (!empty(jwtSecret)) {
  parent: keyVault
  name: 'jwt-secret'
  properties: {
    value: jwtSecret
    attributes: {
      enabled: true
    }
  }
}

resource ssoKeyVaultSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = if (!empty(msClientSecret)) {
  parent: keyVault
  name: 'entra-sso-client-secret'
  properties: {
    value: msClientSecret
    attributes: {
      enabled: true
    }
  }
}

resource appInsightsKeyVaultSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: keyVault
  name: 'app-insights-connection-string'
  properties: {
    value: appInsightsConnectionString
    attributes: {
      enabled: true
    }
  }
}

resource sqlServer 'Microsoft.Sql/servers@2025-01-01' = {
  name: sqlServerName
  location: location
  tags: tags
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlAdminLogin
      principalType: 'User'
      sid: sqlAdminObjectId
      tenantId: tenantId
    }
    publicNetworkAccess: 'Disabled'
    minimalTlsVersion: '1.2'
  }
}

resource entraOnlyAuthentication 'Microsoft.Sql/servers/azureADOnlyAuthentications@2025-01-01' = {
  parent: sqlServer
  name: 'Default'
  properties: {
    azureADOnlyAuthentication: true
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2025-01-01' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  tags: tags
  sku: {
    name: 'GP_S_Gen5_2'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  properties: {
    minCapacity: json('0.5')
    autoPauseDelay: 60
    requestedBackupStorageRedundancy: 'Local'
    maxSizeBytes: 268435456000
  }
}

module blobPrivateEndpoint './private-endpoint.bicep' = {
  name: 'blob-private-endpoint'
  params: {
    location: location
    name: 'pep-${take(storageAccountName, 12)}-blob'
    targetResourceId: storageAccount.id
    groupId: 'blob'
    subnetId: privateEndpointSubnetId
    privateDnsZoneId: blobPrivateDnsZoneId
    tags: tags
  }
}

module sqlPrivateEndpoint './private-endpoint.bicep' = {
  name: 'sql-private-endpoint'
  params: {
    location: location
    name: 'pep-${take(sqlServerName, 12)}-sql'
    targetResourceId: sqlServer.id
    groupId: 'sqlServer'
    subnetId: privateEndpointSubnetId
    privateDnsZoneId: sqlPrivateDnsZoneId
    tags: tags
  }
}

module keyVaultPrivateEndpoint './private-endpoint.bicep' = {
  name: 'keyvault-private-endpoint'
  params: {
    location: location
    name: 'pep-${take(keyVaultName, 12)}-kv'
    targetResourceId: keyVault.id
    groupId: 'vault'
    subnetId: privateEndpointSubnetId
    privateDnsZoneId: keyVaultPrivateDnsZoneId
    tags: tags
  }
}

output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
output storageAccountUrl string = storageAccount.properties.primaryEndpoints.blob
output uploadsContainerId string = uploadsContainer.id
output reportsContainerId string = reportsContainer.id
output stagingContainerId string = stagingContainer.id
output templatesContainerId string = templatesContainer.id
output keyVaultId string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output sqlServerId string = sqlServer.id
output sqlServerName string = sqlServer.name
output sqlDatabaseName string = sqlDatabase.name
