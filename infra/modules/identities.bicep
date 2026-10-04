targetScope = 'resourceGroup'

@description('Azure region for managed identities.')
param location string

@description('API managed identity resource name.')
param apiIdentityName string

@description('Validation worker and rules-service identity resource name.')
param workerIdentityName string

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

output apiIdentityId string = apiIdentity.id
output apiPrincipalId string = apiIdentity.properties.principalId
output apiClientId string = apiIdentity.properties.clientId
output workerIdentityId string = workerIdentity.id
output workerPrincipalId string = workerIdentity.properties.principalId
output workerClientId string = workerIdentity.properties.clientId
