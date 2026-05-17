# FitnessHealth — full deployment script
# Usage: .\deploy.ps1
#        .\deploy.ps1 -WorkerOnly
#        .\deploy.ps1 -SiteOnly

param(
    [switch]$WorkerOnly,
    [switch]$SiteOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host "FitnessHealth Deploy  |  -WorkerOnly  |  -SiteOnly" -ForegroundColor DarkGray

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
    Write-Host "    $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "    $msg" -ForegroundColor Red
}

# ── Worker ────────────────────────────────────────────────────────────────────
if (-not $SiteOnly) {
    Write-Step "Deploying Cloudflare Worker (calorie-extractor)..."
    try {
        & wrangler deploy --config "$root\worker\wrangler.toml"
        Write-Ok "Worker deployed successfully."
    } catch {
        Write-Fail "Worker deployment failed: $_"
        exit 1
    }
}

# ── Static site ───────────────────────────────────────────────────────────────
if (-not $WorkerOnly) {
    Write-Step "Deploying static site (fitnesshealth.app)..."
    try {
        Push-Location $root
        & wrangler deploy
        Pop-Location
        Write-Ok "Site deployed successfully."
    } catch {
        Pop-Location
        Write-Fail "Site deployment failed: $_"
        exit 1
    }
}

Write-Host "`nDone." -ForegroundColor Green
