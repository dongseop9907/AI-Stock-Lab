param(
  [string]$Target = ".\run-opendart-corporate-action-source-inventory-v9-7-1.ps1"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Target)) {
  throw "TARGET_NOT_FOUND: $Target"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$Target.backup-v9-7-1-hotfix-$timestamp"
Copy-Item $Target $backup -Force

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText(
  (Resolve-Path $Target).Path,
  [System.Text.Encoding]::UTF8
)

$classifier = @'
function Classify-ReportName([string]$ReportName) {
  $types = New-Object System.Collections.Generic.List[string]

  if ($ReportName -match "주식분할") {
    $types.Add("STOCK_SPLIT")
  }

  if ($ReportName -match "주식병합") {
    $types.Add("REVERSE_SPLIT")
  }

  if ($ReportName -match "현금.*배당결정") {
    $types.Add("CASH_DIVIDEND")
  }

  if ($ReportName -match "주식배당결정") {
    $types.Add("STOCK_DIVIDEND")
  }

  if ($ReportName -match "유상증자결정") {
    $types.Add("RIGHTS_ISSUE")
  }

  if (
    $ReportName -match "회사분할결정" -or
    $ReportName -match "회사분할합병결정"
  ) {
    $types.Add("SPIN_OFF")
  }

  if ($ReportName -match "회사합병결정") {
    $types.Add("MERGER")
  }

  return [string[]]$types.ToArray()
}

'@

$pattern = '(?s)function Classify-ReportName\(\[string\]\$ReportName\)\s*\{.*?\}\s*\r?\n\s*function Get-DisclosurePages'
$matches = [regex]::Matches($content, $pattern)

if ($matches.Count -ne 1) {
  throw "CLASSIFIER_PATCH_TARGET_COUNT: $($matches.Count)"
}

$content = [regex]::Replace(
  $content,
  $pattern,
  $classifier + 'function Get-DisclosurePages',
  1
)

$oldCandidates = '@($candidates) | ConvertTo-Json -Depth 10 | Set-Content $path -Encoding UTF8'

$newCandidates = @'
    $candidateArray =
      [object[]]$candidates.ToArray()

    $candidateJson =
      ConvertTo-Json `
        -InputObject $candidateArray `
        -Depth 10

    [System.IO.File]::WriteAllText(
      $path,
      $candidateJson,
      $utf8NoBom
    )
'@

$count = ([regex]::Matches(
  $content,
  [regex]::Escape($oldCandidates)
)).Count

if ($count -ne 1) {
  throw "CANDIDATE_SERIALIZATION_PATCH_TARGET_COUNT: $count"
}

$content = $content.Replace(
  $oldCandidates,
  $newCandidates.TrimEnd()
)

$anchor = '$ErrorActionPreference = "Stop"'
if (-not $content.Contains('$utf8NoBom = New-Object System.Text.UTF8Encoding($false)')) {
  $content = $content.Replace(
    $anchor,
    $anchor + "`r`n`r`n" + '$utf8NoBom = New-Object System.Text.UTF8Encoding($false)'
  )
}

[System.IO.File]::WriteAllText(
  (Resolve-Path $Target).Path,
  $content,
  $utf8NoBom
)

Write-Host ""
Write-Host "v9.7.1 OpenDART inventory PowerShell 5.1 hotfix applied."
Write-Host "Target: $Target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Fixed:"
Write-Host "  - Generic.List[object] JSON serialization"
Write-Host "  - Corrupted Korean report-name classifier literals"
Write-Host "  - UTF-8 no-BOM output for candidate JSON"
