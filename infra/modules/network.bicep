targetScope = 'resourceGroup'

@description('Azure region for the network resources.')
param location string

@description('Name of the workload VNet.')
param virtualNetworkName string

@description('CIDR address space for the workload VNet.')
param addressPrefix string

@description('CIDR for the delegated Container Apps workload-profile subnet.')
param containerAppsSubnetPrefix string

@description('CIDR for private endpoint network interfaces.')
param privateEndpointSubnetPrefix string

@description('Tags applied to resources.')
param tags object

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2025-09-01' = {
  name: virtualNetworkName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        addressPrefix
      ]
    }
    subnets: [
      {
        name: 'snet-container-apps'
        properties: {
          addressPrefix: containerAppsSubnetPrefix
          delegations: [
            {
              name: 'container-apps'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource blobPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}

resource sqlPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink${environment().suffixes.sqlServerHostname}'
  location: 'global'
  tags: tags
}

resource keyVaultPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}

resource blobZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: blobPrivateDnsZone
  name: '${virtualNetworkName}-blob'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource sqlZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: sqlPrivateDnsZone
  name: '${virtualNetworkName}-sql'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource keyVaultZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: keyVaultPrivateDnsZone
  name: '${virtualNetworkName}-keyvault'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

output virtualNetworkId string = virtualNetwork.id
output containerAppsSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', virtualNetwork.name, 'snet-container-apps')
output privateEndpointSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', virtualNetwork.name, 'snet-private-endpoints')
output blobPrivateDnsZoneId string = blobPrivateDnsZone.id
output sqlPrivateDnsZoneId string = sqlPrivateDnsZone.id
output keyVaultPrivateDnsZoneId string = keyVaultPrivateDnsZone.id
