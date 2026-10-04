$ErrorActionPreference = 'Stop'

function Get-AzdValue {
    param([Parameter(Mandatory)][string]$Name)

    $value = & azd env get-value $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
        throw "Required azd environment value '$Name' is missing."
    }
    return $value.Trim()
}

$registryName = Get-AzdValue 'AZURE_CONTAINER_REGISTRY_NAME'
$registryLoginServer = Get-AzdValue 'ACR_LOGIN_SERVER'
$resourceGroup = Get-AzdValue 'AZURE_RESOURCE_GROUP'
$workerJobName = Get-AzdValue 'WORKER_JOB_NAME'
$imageTag = Get-AzdValue 'IMAGE_TAG'
$apiUrl = Get-AzdValue 'API_URL'

if ($imageTag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') {
    throw 'IMAGE_TAG must use only letters, numbers, underscores, periods, and hyphens.'
}

& az acr login --name $registryName --only-show-errors
if ($LASTEXITCODE -ne 0) {
    throw 'Azure Container Registry login failed.'
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$images = @(
    @{
        Name = 'api'
        Dockerfile = Join-Path $repositoryRoot 'Back-End\Dockerfile'
    },
    @{
        Name = 'validation-service'
        Dockerfile = Join-Path $repositoryRoot 'Validation-Service\Dockerfile'
    }
)

foreach ($image in $images) {
    $imageReference = "$registryLoginServer/$($image.Name):$imageTag"
    & docker build --file $image.Dockerfile --tag $imageReference $repositoryRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Building container image '$($image.Name)' failed."
    }
    & docker push $imageReference
    if ($LASTEXITCODE -ne 0) {
        throw "Pushing container image '$($image.Name)' failed."
    }
}

$env:VITE_API_URL = $apiUrl
Push-Location (Join-Path $repositoryRoot 'Front-End')
try {
    & npm ci
    if ($LASTEXITCODE -ne 0) {
        throw 'Installing frontend dependencies failed.'
    }
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw 'Building the frontend failed.'
    }
}
finally {
    Pop-Location
    Remove-Item Env:\VITE_API_URL -ErrorAction SilentlyContinue
}

$workerImage = "$registryLoginServer/validation-service:$imageTag"
& az containerapp job update `
    --name $workerJobName `
    --resource-group $resourceGroup `
    --image $workerImage `
    --only-show-errors
if ($LASTEXITCODE -ne 0) {
    throw 'Updating the validation worker image failed.'
}

Write-Host "Built and pushed application images for tag '$imageTag'."
