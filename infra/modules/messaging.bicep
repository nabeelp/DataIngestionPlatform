targetScope = 'resourceGroup'

@description('Azure region for Service Bus.')
param location string

@description('Globally unique Service Bus namespace name.')
param namespaceName string

@description('Tags applied to resources.')
param tags object

resource serviceBus 'Microsoft.ServiceBus/namespaces@2026-01-01' = {
  name: namespaceName
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource validationRequests 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = {
  parent: serviceBus
  name: 'validation-requests'
  properties: {
    lockDuration: 'PT5M'
    maxDeliveryCount: 3
    deadLetteringOnMessageExpiration: true
    requiresDuplicateDetection: false
    requiresSession: false
    enablePartitioning: false
  }
}

resource deliveryRequests 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = {
  parent: serviceBus
  name: 'delivery-requests'
  properties: {
    lockDuration: 'PT5M'
    maxDeliveryCount: 5
    deadLetteringOnMessageExpiration: true
    requiresDuplicateDetection: false
    requiresSession: false
    enablePartitioning: false
  }
}

resource validationEvents 'Microsoft.ServiceBus/namespaces/topics@2024-01-01' = {
  parent: serviceBus
  name: 'validation-events'
  properties: {
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    enablePartitioning: false
  }
}

resource apiSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' = {
  parent: validationEvents
  name: 'api'
  properties: {
    deadLetteringOnMessageExpiration: true
    requiresSession: false
  }
}

output namespaceId string = serviceBus.id
output namespaceName string = serviceBus.name
output fullyQualifiedNamespace string = '${serviceBus.name}.servicebus.windows.net'
