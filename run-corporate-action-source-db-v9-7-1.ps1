param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$StartDate = "2023-01-02",
  [string]$EndDate = "2026-07-31",
  [string]$StatePath = ".\logs\corporate-action-source-db-v9-7-1.json",
  [ValidateRange(300,60000)][int]$DelayMs = 500,
  [ValidateRange(1,100000)][int]$MaxPages = 100000
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
# Limit credentials to local dev server. Do not send this token to an arbitrary URL.
$uri = [uri]$BaseUrl
if ($uri.Scheme -ne 'http' -or $uri.Host -notin @('localhost','127.0.0.1','[::1]') -or $uri.UserInfo) { throw 'USE_LOCAL_HTTP_BASE_URL' }
$token = $env:CORPORATE_ACTION_IMPORT_TOKEN
if (-not $token -and (Test-Path '.\.env.local')) {
  foreach ($line in Get-Content '.\.env.local') {
    if ($line -match '^\s*CORPORATE_ACTION_IMPORT_TOKEN\s*=(.*)$') { $token = $Matches[1].Trim().Trim('"').Trim("'") }
  }
}
if (-not $token -or $token.Length -lt 32) { throw 'SET_CORPORATE_ACTION_IMPORT_TOKEN_IN_ENV_LOCAL_MIN_32_CHARS' }
$headers = @{ Authorization = "Bearer $token" }
$api = $BaseUrl.TrimEnd('/') + '/api/research/data/v9/corporate-action-source'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save-Checkpoint($value) {
  $full = [IO.Path]::GetFullPath($StatePath)
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($full)) | Out-Null
  $tmp = $full + '.tmp'
  [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $value -Depth 12), $utf8)
  if (Test-Path -LiteralPath $full) { [IO.File]::Replace($tmp,$full,$null) }
  else { [IO.File]::Move($tmp,$full) }
}
function Post-Json([string]$Path, $Body) {
  $json = ConvertTo-Json -InputObject $Body -Depth 10 -Compress
  # No hidden retry on DART quota/auth errors. Cursor remains durable; rerun to resume.
  $response = Invoke-RestMethod -Method Post -Uri "$api/$Path" -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec 90
  if (-not $response.ok) { throw 'API_RETURNED_NOT_OK' }
  return $response
}
if (Test-Path -LiteralPath $StatePath) {
  $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  if ($state.startDate -ne $StartDate -or $state.endDate -ne $EndDate -or $state.baseUrl -ne $BaseUrl) { throw 'STATE_CONFIG_MISMATCH_USE_NEW_STATE_PATH' }
} else {
  $state = [pscustomobject]@{ runId=[guid]::NewGuid().ToString(); startDate=$StartDate; endDate=$EndDate; baseUrl=$BaseUrl }
  Save-Checkpoint $state
}
Write-Host "Run ID: $($state.runId)"
$created = Post-Json 'create' @{ runId=$state.runId; startDate=$StartDate; endDate=$EndDate }
$run = $created.run
for ($i=0; $i -lt $MaxPages -and $run.status -ne 'INVENTORY_COMPLETE'; $i++) {
  $result = Post-Json 'process' @{ runId=$state.runId }
  $run = $result.run
  Write-Host ("{0} pages={1} disclosures={2} candidateHints={3} cursor={4}/{5}/page-{6}" -f $run.status,$run.stored_pages,$run.disclosure_count,$run.candidate_count,$run.chunk_start,$run.corp_cls,$run.next_page)
  if ($run.status -ne 'INVENTORY_COMPLETE') { Start-Sleep -Milliseconds $DelayMs }
}
Write-Host 'Saved DB progress (rerun same command to resume):'
$run | ConvertTo-Json -Depth 10
Write-Host 'Inventory is disclosure-list coverage only. v9.7 remains BLOCKED_SOURCE_COVERAGE until real event coverage is verified.'
