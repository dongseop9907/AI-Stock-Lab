param(
    [string]$Root =
        "C:\Users\user\Desktop\ai-stock-lab"
)

$ErrorActionPreference = "Stop"

$target =
    Join-Path `
        $Root `
        "lib\research\evaluate-historical-market-data-coverage-v9-6.ts"

if (
    -not (
        Test-Path $target
    )
) {
    throw "TARGET_NOT_FOUND: $target"
}

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

$backup =
    "$target.backup-v9-6-4-$timestamp"

Copy-Item `
    $target `
    $backup `
    -Force

Write-Host "BACKUP: $backup"

$content =
    Get-Content `
        $target `
        -Raw

$pattern =
'(?s)    const rows:\s*CoverageRow\[\]\s*=\s*\[\];\s*' +
'    const pageSize\s*=\s*500;\s*' +
'    for\s*\(\s*let offset\s*=\s*0;\s*;\s*offset \+=\s*pageSize\s*\)\s*\{.*?' +
'      if\s*\(\s*page\.length <\s*pageSize\s*\)\s*\{\s*break;\s*\}\s*    \}'

$replacement = @'
    const rows:
      CoverageRow[] = [];

    /*
     * v9.6.4:
     * Full Historical PIT now spans ~2.3M expected stock-days.
     * The original 500-security RPC page can exceed PostgreSQL
     * statement_timeout even at offset 0.
     *
     * Start conservatively at 50 securities per RPC and, only when
     * PostgreSQL reports statement timeout, retry the SAME offset with
     * progressively smaller pages down to 10.
     *
     * This changes computation granularity only:
     * - exact Historical PIT compilation is unchanged
     * - market_daily_bars is read-only
     * - current universe is never substituted
     * - thresholds and final COMPLETE criteria are unchanged
     */
    let offset =
      0;

    let pageSize =
      50;

    const minimumPageSize =
      10;

    while (
      true
    ) {
      let requestedPageSize =
        pageSize;

      let page:
        CoverageRow[] =
        [];

      while (
        true
      ) {
        const {
          data,
          error,
        } =
          await supabase
            .rpc(
              "compute_historical_market_data_coverage_v9_6",
              {
                p_compilation_run_id:
                  compilation.id,

                p_start_date:
                  startDate,

                p_end_date:
                  endDate,

                p_offset:
                  offset,

                p_limit:
                  requestedPageSize,
              },
            );

        if (
          !error
        ) {
          page =
            (
              data ??
              []
            ) as CoverageRow[];

          break;
        }

        const message =
          String(
            error.message ??
            "",
          );

        const timedOut =
          message
            .toLowerCase()
            .includes(
              "statement timeout",
            );

        if (
          !timedOut ||
          requestedPageSize <=
            minimumPageSize
        ) {
          throw new Error(
            `v9.6 coverage RPC failed at offset ${offset} ` +
            `pageSize=${requestedPageSize}: ${message}`,
          );
        }

        requestedPageSize =
          Math.max(
            minimumPageSize,
            Math.floor(
              requestedPageSize /
              2,
            ),
          );
      }

      pageSize =
        requestedPageSize;

      rows.push(
        ...page,
      );

      offset +=
        page.length;

      if (
        page.length <
          pageSize
      ) {
        break;
      }
    }
'@

$regex =
    [regex]::new(
        $pattern
    )

$matches =
    $regex.Matches(
        $content
    )

if (
    $matches.Count -ne 1
) {
    throw (
        "PATCH_TARGET_COUNT_MISMATCH: " +
        $matches.Count +
        ". Backup preserved at $backup"
    )
}

$patched =
    $regex.Replace(
        $content,
        $replacement,
        1
    )

Set-Content `
    -Path $target `
    -Value $patched `
    -Encoding UTF8

Write-Host "PATCHED: $target"
Write-Host ""
Write-Host "v9.6.4 adaptive coverage pagination installed."
Write-Host "Initial RPC page size: 50 securities"
Write-Host "Timeout fallback: 25 -> 12 -> 10"
Write-Host "Historical PIT semantics: unchanged"
Write-Host "Coverage thresholds: unchanged"
Write-Host "Production applied: false"
Write-Host ""
Write-Host "Next:"
Write-Host "  npx.cmd tsc --noEmit"
Write-Host "  npm.cmd run build"
