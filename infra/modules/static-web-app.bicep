targetScope = 'resourceGroup'

@description('Globally unique Azure Static Web Apps resource name.')
param name string

@description('Azure region for the Static Web App resource.')
param location string

@description('Tags applied to resources.')
param tags object

resource staticWebApp 'Microsoft.Web/staticSites@2025-03-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    buildProperties: {
      appLocation: '/'
      apiLocation: ''
      outputLocation: 'dist'
    }
  }
}

output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output url string = 'https://${staticWebApp.properties.defaultHostname}'
