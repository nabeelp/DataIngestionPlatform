targetScope = 'resourceGroup'

@description('Azure region for managed identities.')
param location string

@description('API managed identity resource name.')
param apiIdentityName string

@description('Validation worker and rules-service identity resource name.')
param workerIdentityName string

@description('Temporary SQL bootstrap identity resource name.')
param sqlBootstrapIdentityName string

@description('Frontend image-pull managed identity resource name.')
param frontendIdentityName string

@description('Tags applied to resources.')
param tags object

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: apiIdentityName
  location: location
  tags: tags
}

resource workerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: workerIdentityName
  location: location
  tags: tags
}

resource sqlBootstrapIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: sqlBootstrapIdentityName
  location: location
  tags: tags
}

resource frontendIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: frontendIdentityName
  location: location
  tags: tags
}

output apiIdentityId string = apiIdentity.id
output apiPrincipalId string = apiIdentity.properties.principalId
output apiClientId string = apiIdentity.properties.clientId
output workerIdentityId string = workerIdentity.id
output workerPrincipalId string = workerIdentity.properties.principalId
output workerClientId string = workerIdentity.properties.clientId
output sqlBootstrapIdentityId string = sqlBootstrapIdentity.id
output sqlBootstrapPrincipalId string = sqlBootstrapIdentity.properties.principalId
output sqlBootstrapClientId string = sqlBootstrapIdentity.properties.clientId
output frontendIdentityId string = frontendIdentity.id
output frontendPrincipalId string = frontendIdentity.properties.principalId
