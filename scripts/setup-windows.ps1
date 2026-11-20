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

# Optional. One email=password pair per line, or several pairs separated by semicolons.
# Used only to create accounts that do not exist yet. Those accounts join Services AI Automation.
HARBOR_SEED_PASSWORDS=
"@ | Set-Content -Path ".env" -Encoding ascii
    Write-Host "Created .env in $root"
}

$seedFile = Join-Path $root "seed-passwords.txt"
if ((Test-Path $seedFile) -and (Select-String -Path ".env" -Pattern "^HARBOR_SEED_PASSWORDS=.+" -Quiet) -eq $false) {
    $pairs = @()
    foreach ($line in (Get-Content $seedFile)) {
        $trimmed = $line.Trim()
        if ($trimmed -and -not $trimmed.StartsWith("#") -and $trimmed.Contains("=")) {
            $pairs += $trimmed.Trim('"').Trim("'")
        }
    }
    if ($pairs.Count -gt 0) {
        $seedLine = "HARBOR_SEED_PASSWORDS=" + ($pairs -join ";")
        if (Select-String -Path ".env" -Pattern "^HARBOR_SEED_PASSWORDS=" -Quiet) {
            (Get-Content ".env") | ForEach-Object {
                if ($_ -match "^HARBOR_SEED_PASSWORDS=") { $seedLine } else { $_ }
            } | Set-Content -Path ".env" -Encoding ascii
        } else {
            Add-Content -Path ".env" -Value $seedLine -Encoding ascii
        }
        Write-Host "Loaded account passwords from seed-passwords.txt"
    }
}

Write-Host "Starting Harbor from $root"
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Harbor is running on this PC."
Write-Host "Open http://127.0.0.1:8080"
$seeded = Select-String -Path ".env" -Pattern "^HARBOR_SEED_PASSWORDS=.+" -Quiet
if ($seeded) {
    Write-Host "Sign in with the accounts listed in .env. They are on the Services AI Automation team."
} else {
    Write-Host "The first visit asks you to create the admin account."
    Write-Host "To load the Powerweave accounts, put email=password pairs in seed-passwords.txt and run this script again."
}
