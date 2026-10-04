targetScope = 'resourceGroup'

@description('Azure region for the private endpoint.')
param location string

@description('Private endpoint name.')
param name string

@description('Private Link resource ID.')
param targetResourceId string

@description('Private Link subresource group ID.')
param groupId string

@description('Private endpoint subnet resource ID.')
param subnetId string

@description('Private DNS zone resource ID for this endpoint.')
param privateDnsZoneId string

@description('Tags applied to resources.')
param tags object

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2025-09-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${name}-connection'
        properties: {
          privateLinkServiceId: targetResourceId
          groupIds: [
            groupId
          ]
        }
      }
    ]
  }
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2025-09-01' = {
  parent: privateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: groupId
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}

output privateEndpointId string = privateEndpoint.id
