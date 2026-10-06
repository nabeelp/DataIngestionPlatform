targetScope = 'resourceGroup'

@description('Azure region for Container Apps.')
param location string

@description('Container Apps environment name.')
param environmentName string

@description('Node API Container App name.')
param apiContainerAppName string

@description('Python rules-service Container App name.')
param rulesServiceContainerAppName string

@description('Validation worker Container Apps Job name.')
param workerJobName string

@description('One-shot SQL bootstrap Container Apps Job name.')
param sqlBootstrapJobName string

@description('Frontend Container App name.')
param frontendContainerAppName string

@description('Azure Container Registry login server.')
param registryLoginServer string

@description('CPU cores allocated to each validation worker execution.')
param workerCpu int

@description('Memory allocated to each validation worker execution.')
param workerMemory string

@description('API user-assigned identity resource ID.')
param apiIdentityId string

@description('API user-assigned identity client ID.')
param apiClientId string

@description('API user-assigned identity principal ID.')
param apiPrincipalId string

@description('Worker user-assigned identity resource ID.')
param workerIdentityId string

@description('Worker user-assigned identity client ID.')
param workerClientId string

@description('API user-assigned identity resource name.')
param apiIdentityName string

@description('Worker user-assigned identity resource name.')
param workerIdentityName string

@description('SQL bootstrap user-assigned identity resource ID.')
param sqlBootstrapIdentityId string

@description('SQL bootstrap user-assigned identity client ID.')
param sqlBootstrapClientId string

@description('Frontend image-pull user-assigned identity resource ID.')
param frontendIdentityId string

@description('Container Apps delegated subnet ID.')
param containerAppsSubnetId string

@description('Log Analytics workspace customer ID.')
param logAnalyticsCustomerId string

@description('Log Analytics workspace resource ID.')
param logAnalyticsWorkspaceId string

@description('Storage account Blob endpoint.')
param storageAccountUrl string

@description('SQL logical server name.')
param sqlServerName string

@description('SQL database name.')
param sqlDatabaseName string

@description('Key Vault URI.')
param keyVaultUri string

@description('Service Bus namespace FQDN.')
param serviceBusNamespace string

@description('Service Bus namespace name without the FQDN suffix.')
param serviceBusNamespaceName string

@description('Microsoft Entra tenant ID.')
param tenantId string

@description('Client ID of the existing Microsoft Entra SSO application.')
param ssoClientId string

@description('Dedicated rules-service API registration client ID.')
param rulesServiceApiClientId string

@description('Dedicated rules-service API registration audience, such as api://<client-id>.')
param rulesServiceApiAudience string

@description('Foundry account resource name.')
param foundryResourceName string

@description('Foundry project name.')
param foundryProjectName string

@description('Tags applied to resources.')
param tags object

// Keep provisioning independent of ACR image availability; azd deploy replaces this image after AcrPull propagates.
var bootstrapImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var logAnalyticsSharedKey = listKeys(logAnalyticsWorkspaceId, '2025-07-01').primarySharedKey

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    vnetConfiguration: {
      infrastructureSubnetId: containerAppsSubnetId
      internal: false
    }
  }
}

resource apiContainerApp 'Microsoft.App/containerApps@2025-07-01' = {
  name: apiContainerAppName
  location: location
  tags: union(tags, {
    'azd-service-name': 'api'
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${apiIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: [
        {
          name: 'jwt-secret'
          keyVaultUrl: '${keyVaultUri}secrets/jwt-secret'
          identity: apiIdentityId
        }
        {
          name: 'entra-sso-client-secret'
          keyVaultUrl: '${keyVaultUri}secrets/entra-sso-client-secret'
          identity: apiIdentityId
        }
        {
          name: 'app-insights-connection-string'
          keyVaultUrl: '${keyVaultUri}secrets/app-insights-connection-string'
          identity: apiIdentityId
        }
      ]
      registries: [
        {
          server: registryLoginServer
          identity: apiIdentityId
        }
      ]
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
      containers: [
        {
          name: 'api'
          image: bootstrapImage
          resources: {
            cpu: 1
            memory: '2Gi'
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'JWT_SECRET'
              secretRef: 'jwt-secret'
            }
            {
              name: 'MS_CLIENT_SECRET'
              secretRef: 'entra-sso-client-secret'
            }
            {
              name: 'MS_TENANT_ID'
              value: tenantId
            }
            {
              name: 'MS_CLIENT_ID'
              value: ssoClientId
            }
            {
              name: 'MS_REDIRECT_URI'
              value: 'https://invalid.invalid/auth/callback'
            }
            {
              name: 'MS_SSO_ENABLED'
              value: 'true'
            }
            {
              name: 'CORS_ORIGIN'
              value: 'https://invalid.invalid'
            }
            {
              name: 'DB_SERVER'
              value: '${sqlServerName}${environment().suffixes.sqlServerHostname}'
            }
            {
              name: 'DB_DATABASE'
              value: sqlDatabaseName
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: apiClientId
            }
            {
              name: 'AZURE_STORAGE_ACCOUNT_URL'
              value: storageAccountUrl
            }
            {
              name: 'AZURE_STORAGE_UPLOADS_CONTAINER'
              value: 'uploads'
            }
            {
              name: 'AZURE_STORAGE_REPORTS_CONTAINER'
              value: 'reports'
            }
            {
              name: 'AZURE_STORAGE_DELIVERIES_CONTAINER'
              value: 'deliveries'
            }
            {
              name: 'AZURE_STORAGE_TEMPLATES_CONTAINER'
              value: 'templates'
            }
            {
              name: 'DELIVERY_PROVIDER'
              value: 'azure'
            }
            {
              name: 'STORAGE_PROVIDER'
              value: 'azure'
            }
            {
              name: 'SERVICEBUS_NAMESPACE'
              value: serviceBusNamespace
            }
            {
              name: 'SERVICEBUS_VALIDATION_QUEUE'
              value: 'validation-requests'
            }
            {
              name: 'SERVICEBUS_EVENTS_TOPIC'
              value: 'validation-events'
            }
            {
              name: 'SERVICEBUS_EVENTS_SUBSCRIPTION'
              value: 'api'
            }
            {
              name: 'SERVICEBUS_DELIVERY_QUEUE'
              value: 'delivery-requests'
            }
            {
              name: 'RULES_SERVICE_URL'
              value: 'https://${rulesServiceContainerApp.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'RULES_SERVICE_AAD_SCOPE'
              value: '${rulesServiceApiAudience}/.default'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
            {
              name: 'AZURE_FOUNDRY_RESOURCE'
              value: foundryResourceName
            }
            {
              name: 'AZURE_FOUNDRY_PROJECT'
              value: foundryProjectName
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
    }
  }
}

resource frontendContainerApp 'Microsoft.App/containerApps@2025-07-01' = {
  name: frontendContainerAppName
  location: location
  tags: union(tags, {
    'azd-service-name': 'frontend'
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${frontendIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registryLoginServer
          identity: frontendIdentityId
        }
      ]
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      scale: {
        minReplicas: 0
        maxReplicas: 2
        rules: [
          {
            name: 'http-requests'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
      containers: [
        {
          name: 'frontend'
          image: bootstrapImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'API_URL'
              value: 'https://${apiContainerApp.properties.configuration.ingress.fqdn}/api/v1'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 3
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
    }
  }
}

resource rulesServiceContainerApp 'Microsoft.App/containerApps@2025-07-01' = {
  name: rulesServiceContainerAppName
  location: location
  tags: union(tags, {
    'azd-service-name': 'rules-service'
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workerIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
    secrets: [
      {
        name: 'app-insights-connection-string'
        keyVaultUrl: '${keyVaultUri}secrets/app-insights-connection-string'
        identity: workerIdentityId
      }
    ]
    registries: [
        {
          server: registryLoginServer
          identity: workerIdentityId
        }
      ]
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
      containers: [
        {
          name: 'rules-service'
          image: bootstrapImage
          command: [
            'dq-engine'
          ]
          args: [
            'api'
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'RULES_SERVICE_HOST'
              value: '0.0.0.0'
            }
            {
              name: 'RULES_SERVICE_PORT'
              value: '8000'
            }
            {
              name: 'RULES_SERVICE_AUTH_MODE'
              value: 'entra'
            }
            {
              name: 'RULES_SERVICE_API_PRINCIPAL_ID'
              value: apiPrincipalId
            }
            {
              name: 'DB_SERVER'
              value: '${sqlServerName}${environment().suffixes.sqlServerHostname}'
            }
            {
              name: 'DB_DATABASE'
              value: sqlDatabaseName
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: workerClientId
            }
            {
              name: 'AZURE_STORAGE_ACCOUNT_URL'
              value: storageAccountUrl
            }
            {
              name: 'SERVICEBUS_NAMESPACE'
              value: serviceBusNamespace
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/healthz'
                port: 8000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/healthz'
                port: 8000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
    }
  }
}

resource rulesServiceAuth 'Microsoft.App/containerApps/authConfigs@2025-07-01' = {
  parent: rulesServiceContainerApp
  name: 'current'
  properties: {
    platform: {
      enabled: true
      runtimeVersion: '~1'
    }
    globalValidation: {
      unauthenticatedClientAction: 'Return401'
    }
    identityProviders: {
      azureActiveDirectory: {
        registration: {
          clientId: rulesServiceApiClientId
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [
            rulesServiceApiAudience
          ]
          defaultAuthorizationPolicy: {
            allowedApplications: [
              apiClientId
            ]
          }
        }
      }
    }
  }
}

resource validationWorker 'Microsoft.App/jobs@2025-07-01' = {
  name: workerJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workerIdentityId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Event'
      replicaTimeout: 1800
      replicaRetryLimit: 2
      secrets: [
        {
          name: 'app-insights-connection-string'
          keyVaultUrl: '${keyVaultUri}secrets/app-insights-connection-string'
          identity: workerIdentityId
        }
      ]
      registries: [
        {
          server: registryLoginServer
          identity: workerIdentityId
        }
      ]
      eventTriggerConfig: {
        parallelism: 5
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: 5
          pollingInterval: 30
          rules: [
            {
              name: 'validation-requests'
              type: 'azure-servicebus'
              metadata: {
                namespace: serviceBusNamespaceName
                queueName: 'validation-requests'
                messageCount: '1'
              }
              identity: workerIdentityId
            }
          ]
        }
      }
    }
    template: {
      containers: [
        {
          name: 'validation-worker'
          image: bootstrapImage
          command: [
            'dq-engine'
          ]
          args: [
            'worker'
            '--max-messages'
            '1'
          ]
          resources: {
            cpu: workerCpu
            memory: workerMemory
          }
          env: [
            {
              name: 'WORKER_MODE'
              value: 'job'
            }
            {
              name: 'WORKER_MAX_MESSAGES'
              value: '1'
            }
            {
              name: 'DB_SERVER'
              value: '${sqlServerName}${environment().suffixes.sqlServerHostname}'
            }
            {
              name: 'DB_DATABASE'
              value: sqlDatabaseName
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: workerClientId
            }
            {
              name: 'AZURE_STORAGE_ACCOUNT_URL'
              value: storageAccountUrl
            }
            {
              name: 'SERVICEBUS_NAMESPACE'
              value: serviceBusNamespace
            }
            {
              name: 'SERVICEBUS_VALIDATION_QUEUE'
              value: 'validation-requests'
            }
            {
              name: 'SERVICEBUS_EVENTS_TOPIC'
              value: 'validation-events'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
          ]
        }
      ]
    }
  }
}

resource sqlBootstrapJob 'Microsoft.App/jobs@2025-07-01' = {
  name: sqlBootstrapJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${sqlBootstrapIdentityId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 2
      registries: [
        {
          server: registryLoginServer
          identity: sqlBootstrapIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'sql-bootstrap'
          image: bootstrapImage
          command: [
            'node'
          ]
          args: [
            'dist/scripts/bootstrapSql.js'
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'DB_SERVER'
              value: '${sqlServerName}${environment().suffixes.sqlServerHostname}'
            }
            {
              name: 'DB_DATABASE'
              value: sqlDatabaseName
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: sqlBootstrapClientId
            }
            {
              name: 'API_IDENTITY_NAME'
              value: apiIdentityName
            }
            {
              name: 'API_IDENTITY_CLIENT_ID'
              value: apiClientId
            }
            {
              name: 'WORKER_IDENTITY_NAME'
              value: workerIdentityName
            }
            {
              name: 'WORKER_IDENTITY_CLIENT_ID'
              value: workerClientId
            }
          ]
        }
      ]
    }
  }
}

output apiUrl string = 'https://${apiContainerApp.properties.configuration.ingress.fqdn}/api/v1'
output apiContainerAppName string = apiContainerApp.name
output frontendContainerAppName string = frontendContainerApp.name
output frontendUrl string = 'https://${frontendContainerApp.properties.configuration.ingress.fqdn}'
output rulesServiceUrl string = 'https://${rulesServiceContainerApp.properties.configuration.ingress.fqdn}'
output rulesServiceContainerAppName string = rulesServiceContainerApp.name
output workerJobName string = validationWorker.name
output sqlBootstrapJobName string = sqlBootstrapJob.name
