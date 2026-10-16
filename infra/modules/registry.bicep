targetScope = 'resourceGroup'

@description('Azure region for the registry.')
param location string

@description('Globally unique registry name containing only lowercase alphanumeric characters.')
param registryName string

@description('Tags applied to resources.')
param tags object

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

output registryId string = registry.id
output registryName string = registry.name
output loginServer string = registry.properties.loginServer
