# Start Harbor on this Windows PC. Run it from the project folder, for example D:\Harbor.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker Desktop is not installed. Install it, start it, then run this script again from $root."
    exit 1
}

function New-Hex([int]$ByteCount) {
    $buffer = New-Object byte[] $ByteCount
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

if (-not (Test-Path ".env")) {
    $postgres = New-Hex 18
    $jwt = New-Hex 32
    @"
POSTGRES_PASSWORD=$postgres
JWT_SECRET=$jwt
APP_BASE_URL=http://127.0.0.1:8080
COOKIE_SECURE=false
DATABASE_URL=postgresql+psycopg://harbor:${postgres}@localhost:5432/harbor

# Optional. One email=password pair per line, inside quotes, to create accounts that do not exist yet.
# HARBOR_SEED_PASSWORDS="name@company.com=ChangeMe123"
"@ | Set-Content -Path ".env" -Encoding ascii
    Write-Host "Created .env in $root"
}

Write-Host "Starting Harbor from $root"
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Harbor is running on this PC."
Write-Host "Open http://127.0.0.1:8080"
Write-Host "The first visit asks you to create the admin account."
