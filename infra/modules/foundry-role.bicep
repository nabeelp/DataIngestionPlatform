targetScope = 'resourceGroup'

@description('Full resource ID of the existing Microsoft Foundry project.')
param foundryProjectResourceId string

@description('API managed identity principal ID.')
param apiPrincipalId string

@description('Foundry User role definition ID.')
param foundryUserRoleDefinitionId string

var parts = split(foundryProjectResourceId, '/')
var accountName = parts[8]
var projectName = parts[10]

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2026-07-01' existing = {
  parent: foundryAccount
  name: projectName
}

resource apiFoundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryProject.id, apiPrincipalId, foundryUserRoleDefinitionId)
  scope: foundryProject
  properties: {
    roleDefinitionId: subscriptionResourceId(
      parts[2],
      'Microsoft.Authorization/roleDefinitions',
      foundryUserRoleDefinitionId
    )
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output roleAssignmentId string = apiFoundryUser.id
