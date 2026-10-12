$ErrorActionPreference = 'Stop'
if (-not (Test-Path '.\package.json')) { throw 'RUN_FROM_AI_STOCK_LAB_ROOT' }
$envPath = Join-Path (Get-Location) '.env.local'
$existing = if (Test-Path $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
$matchesFound = [regex]::Matches($existing, '(?m)^\s*CORPORATE_ACTION_IMPORT_TOKEN\s*=([^\r\n]*)')
if ($matchesFound.Count -gt 1) { throw 'DUPLICATE_IMPORT_TOKEN_ENTRIES_FIX_ENV_LOCAL' }
if ($matchesFound.Count -eq 1) {
  $value = $matchesFound[0].Groups[1].Value.Trim().Trim('"').Trim("'")
  if ($value.Length -lt 32) { throw 'EXISTING_IMPORT_TOKEN_MUST_BE_AT_LEAST_32_CHARS' }
  Write-Host 'Existing import token retained.'
} else {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  [IO.File]::AppendAllText($envPath, "`r`nCORPORATE_ACTION_IMPORT_TOKEN=$token`r`n", (New-Object Text.UTF8Encoding($false)))
  Write-Host 'Import token added to .env.local. No token printed.'
}
Write-Host 'Restart npm run dev, then run run-corporate-action-source-db-v9-7-1.ps1.'
