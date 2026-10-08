$ErrorActionPreference = "Stop"
$root = "C:\Users\user\Desktop\ai-stock-lab"
$copies = @(
  @{ Source="evaluate-alpha-forward-outcomes-v9-1.ts"; Target="lib\research\evaluate-alpha-forward-outcomes-v9-1.ts" },
  @{ Source="alpha-v9-1-forward-run-route.ts"; Target="app\api\research\alpha\v9\forward\evaluate\route.ts" },
  @{ Source="alpha-v9-1-forward-status-route.ts"; Target="app\api\research\alpha\v9\forward\status\route.ts" }
)
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
foreach($item in $copies){
  $source=Join-Path $root $item.Source
  $target=Join-Path $root $item.Target
  if(-not (Test-Path $source)){ throw "SOURCE_NOT_FOUND: $source" }
  $dir=Split-Path $target -Parent
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  if(Test-Path $target){ Copy-Item $target "$target.backup-v9-1-$timestamp" -Force }
  Copy-Item $source $target -Force
  Write-Host "COPIED: $($item.Target)"
}
Write-Host ""
Write-Host "v9.1 Alpha Forward Outcome Evaluator installed."
Write-Host "IMPORTANT: Run migration 047 in Supabase first."
Write-Host "Research-only. No trading/risk/production behavior changed."
Write-Host "Next: npx.cmd tsc --noEmit"
