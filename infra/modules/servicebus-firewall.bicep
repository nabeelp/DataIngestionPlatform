targetScope = 'resourceGroup'

@description('Service Bus namespace name.')
param namespaceName string

@description('Container Apps environment outbound IPv4 addresses.')
param containerAppsOutboundIps array

resource serviceBus 'Microsoft.ServiceBus/namespaces@2026-01-01' existing = {
  name: namespaceName
}

resource networkRuleSet 'Microsoft.ServiceBus/namespaces/networkRuleSets@2024-01-01' = {
  parent: serviceBus
  name: 'default'
  properties: {
    defaultAction: 'Deny'
    publicNetworkAccess: 'Enabled'
    ipRules: [for ip in containerAppsOutboundIps: {
        ipMask: '${ip}/32'
        action: 'Allow'
      }]
    virtualNetworkRules: []
    trustedServiceAccessEnabled: false
  }
}

output networkRuleSetId string = networkRuleSet.id
