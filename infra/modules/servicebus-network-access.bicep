targetScope = 'resourceGroup'

@description('Service Bus namespace name.')
param namespaceName string

resource serviceBus 'Microsoft.ServiceBus/namespaces@2026-01-01' existing = {
  name: namespaceName
}

resource networkRuleSet 'Microsoft.ServiceBus/namespaces/networkRuleSets@2024-01-01' = {
  parent: serviceBus
  name: 'default'
  properties: {
    defaultAction: 'Allow'
    publicNetworkAccess: 'Enabled'
    ipRules: []
    virtualNetworkRules: []
    trustedServiceAccessEnabled: false
  }
}
