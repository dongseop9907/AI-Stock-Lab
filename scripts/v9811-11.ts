/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  syncDailyBars,
} from "../lib/market/sync-daily-bars";

const VERSION =
  "V9_8_11_11_16_STOCK_KIS_ADJUSTED_HISTORY_REFRESH_APPLY";

const INPUT_VERSION =
  "V9_8_11_10_2_1_RATIO_REFRESH_COVERAGE_DISPOSITION_REPAIR";

const EXPECTED_REFRESHABLE =
  16;

const EXPECTED_NO_SURFACE =
  2;

const ADJUSTED_PRICE =
  true;

const CHUNK_DAYS =
  90;

interface RefreshPlanRow {
  stockCode: string;
  providerEventId: string;
  actionType: string;
  effectiveDate: string;
  eventId: string;
  runId: string;
  factorId: string;
  totalRowsThroughSnapshot: number;
  unadjustedRowsThroughSnapshot: number;
  earliestBar: {
    tradingDate: string;
    adjustedPrice: boolean;
    source: string | null;
  } | null;
  latestBar: {
    tradingDate: string;
    adjustedPrice: boolean;
    source: string | null;
  } | null;
  refreshStart: string;
  refreshEnd: string;
  chunkDays: number;
  estimatedKisRequests: number;
}

interface InputFile {
  version: string;
  status: string;
  source?: {
    inputFingerprint?: string;
  };
  counts?: Record<string, unknown>;
  refreshablePlan: RefreshPlanRow[];
  noCanonicalBarSurface: unknown[];
  outputFingerprint?: string;
}

interface WindowState {
  stockCode: string;
  rowCount: number;
  unadjustedCount: number;
  earliestDate: string | null;
  latestDate: string | null;
}

interface StockResult {
  stockCode: string;
  providerEventId: string;
  actionType: string;
  effectiveDate: string;
  refreshStart: string;
  refreshEnd: string;
  estimatedKisRequests: number;
  syncReceivedRows: number | null;
  syncSavedRows: number | null;
  syncFailureCount: number;
  before: WindowState;
  after: WindowState;
  rowCountDelta: number;
  earliestBoundaryChanged: boolean;
  latestBoundaryChanged: boolean;
  status: "SUCCESS";
}

interface ProgressFile {
  version: string;
  status:
    | "RUNNING"
    | "KIS_ADJUSTED_HISTORY_REFRESH_APPLY_COMPLETE"
    | "KIS_ADJUSTED_HISTORY_REFRESH_APPLY_ABORTED";
  source: {
    inputVersion: string;
    inputFingerprint: string | null;
  };
  policy: Record<string, unknown>;
  completed: StockResult[];
  failed: null | Record<string, unknown>;
  safety: Record<string, unknown>;
  outputFile: string;
  outputFingerprint?: string;
}

function readJson<T>(
  file: string,
): T {
  return JSON.parse(
    fs
      .readFileSync(
        file,
        "utf8",
      )
      .replace(
        /^\uFEFF/,
        "",
      ),
  ) as T;
}

function atomicSaveJson(
  file: string,
  value: unknown,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
  );

  const tmp =
    `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      value,
      null,
      2,
    ),
    "utf8",
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function sha256(
  value: string,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      value,
    )
    .digest(
      "hex",
    );
}

function requireEnv() {
  const url =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL ||
    process.env
      .SUPABASE_URL;

  const key =
    process.env
      .SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "SUPABASE_URL_REQUIRED",
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY_REQUIRED",
    );
  }

  return {
    url:
      String(url)
        .replace(
          /\/+$/,
          "",
        ),

    key:
      String(key),
  };
}

function postgrestIn(
  values: string[],
) {
  return (
    "(" +
    values
      .map(
        (value) =>
          `"${String(value)
            .replaceAll(
              '"',
              '\\"',
            )}"`,
      )
      .join(",") +
    ")"
  );
}

function parseContentRangeCount(
  value: string | null,
) {
  if (!value) {
    return null;
  }

  const match =
    value.match(
      /\/(\d+|\*)$/,
    );

  if (
    !match ||
    match[1] === "*"
  ) {
    return null;
  }

  const n =
    Number(
      match[1],
    );

  return Number.isInteger(
    n,
  )
    ? n
    : null;
}

async function requestArray(
  url: string,
  key: string,
  countExact = false,
) {
  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers: {
          apikey:
            key,

          Authorization:
            `Bearer ${key}`,

          Accept:
            "application/json",

          ...(countExact
            ? {
                Prefer:
                  "count=exact",
              }
            : {}),
        },
      },
    );

  const text =
    await response
      .text();

  let body:
    unknown;

  try {
    body =
      JSON.parse(
        text,
      );
  } catch {
    throw new Error(
      `INVALID_SUPABASE_JSON_RESPONSE:${response.status}`,
    );
  }

  if (
    !response.ok
  ) {
    const error =
      new Error(
        `SUPABASE_READ_FAILED:${(body as any)?.code ?? response.status}`,
      );

    (error as any)
      .details = {
      status:
        response.status,

      code:
        (body as any)
          ?.code ??
        null,

      message:
        (body as any)
          ?.message ??
        null,

      details:
        (body as any)
          ?.details ??
        null,

      hint:
        (body as any)
          ?.hint ??
        null,
    };

    throw error;
  }

  if (
    !Array.isArray(
      body,
    )
  ) {
    throw new Error(
      "SUPABASE_ARRAY_RESPONSE_REQUIRED",
    );
  }

  return {
    rows:
      body as Record<
        string,
        unknown
      >[],

    count:
      countExact
        ? parseContentRangeCount(
            response
              .headers
              .get(
                "content-range",
              ),
          )
        : null,
  };
}

async function readWindowState(
  baseUrl: string,
  key: string,
  plan: RefreshPlanRow,
) {
  const stock =
    encodeURIComponent(
      plan.stockCode,
    );

  const start =
    encodeURIComponent(
      plan.refreshStart,
    );

  const end =
    encodeURIComponent(
      plan.refreshEnd,
    );

  const select =
    encodeURIComponent(
      "trading_date,adjusted_price,source",
    );

  const base =
    `${baseUrl}/rest/v1/market_daily_bars` +
    `?select=${select}` +
    `&stock_code=eq.${stock}` +
    `&trading_date=gte.${start}` +
    `&trading_date=lte.${end}`;

  const countResult =
    await requestArray(
      `${base}` +
        `&order=trading_date.asc` +
        `&limit=1`,
      key,
      true,
    );

  const latestResult =
    await requestArray(
      `${base}` +
        `&order=trading_date.desc` +
        `&limit=1`,
      key,
    );

  const unadjustedResult =
    await requestArray(
      `${base}` +
        `&adjusted_price=eq.false` +
        `&limit=1`,
      key,
      true,
    );

  const earliest =
    countResult
      .rows[0] ??
    null;

  const latest =
    latestResult
      .rows[0] ??
    null;

  return {
    stockCode:
      plan.stockCode,

    rowCount:
      countResult
        .count ??
      0,

    unadjustedCount:
      unadjustedResult
        .count ??
      0,

    earliestDate:
      typeof earliest
        ?.trading_date ===
        "string"
        ? earliest
            .trading_date
        : null,

    latestDate:
      typeof latest
        ?.trading_date ===
        "string"
        ? latest
            .trading_date
        : null,
  } satisfies WindowState;
}

function toFiniteOrNull(
  value: unknown,
) {
  const n =
    Number(
      value,
    );

  return Number.isFinite(
    n,
  )
    ? n
    : null;
}

function getFailures(
  result: unknown,
) {
  if (
    result &&
    typeof result ===
      "object" &&
    Array.isArray(
      (result as any)
        .failures,
    )
  ) {
    return (
      (result as any)
        .failures as unknown[]
    );
  }

  return [];
}

function getSyncNumber(
  result: unknown,
  key: string,
) {
  if (
    !result ||
    typeof result !==
      "object"
  ) {
    return null;
  }

  return toFiniteOrNull(
    (result as any)[key],
  );
}

function buildFingerprint(
  progress: ProgressFile,
) {
  return sha256(
    JSON.stringify({
      version:
        progress.version,

      inputFingerprint:
        progress.source
          .inputFingerprint,

      status:
        progress.status,

      completed:
        progress.completed
          .map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.refreshStart,
              row.refreshEnd,
              row.after
                .rowCount,
              row.after
                .earliestDate,
              row.after
                .latestDate,
            ],
          ),

      failed:
        progress.failed,
    }),
  );
}

async function main() {
  const args =
    process.argv
      .slice(2);

  if (
    args.length !== 1 ||
    args[0] !==
      "--apply"
  ) {
    throw new Error(
      "EXPLICIT_APPLY_FLAG_REQUIRED_USE_--apply",
    );
  }

  const root =
    path.resolve(
      process.cwd(),
    );

  const inputFile =
    path.join(
      root,
      "logs",
      "opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1.json",
    );

  const outputFile =
    path.join(
      root,
      "logs",
      "opendart-corporate-action-ratio-refresh-apply-v9-8-11-11.json",
    );

  if (
    !fs.existsSync(
      inputFile,
    )
  ) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input =
    readJson<InputFile>(
      inputFile,
    );

  if (
    input.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      "INPUT_VERSION_MISMATCH",
    );
  }

  if (
    input.status !==
    "RATIO_REFRESH_COVERAGE_DISPOSITION_READY"
  ) {
    throw new Error(
      "COVERAGE_DISPOSITION_NOT_READY",
    );
  }

  if (
    !Array.isArray(
      input.refreshablePlan,
    ) ||
    input.refreshablePlan
      .length !==
      EXPECTED_REFRESHABLE
  ) {
    throw new Error(
      "EXPECTED_16_REFRESHABLE_ROWS",
    );
  }

  if (
    !Array.isArray(
      input.noCanonicalBarSurface,
    ) ||
    input
      .noCanonicalBarSurface
      .length !==
      EXPECTED_NO_SURFACE
  ) {
    throw new Error(
      "EXPECTED_2_NO_SURFACE_ROWS",
    );
  }

  const stockCodes =
    input.refreshablePlan
      .map(
        (row) =>
          row.stockCode,
      );

  if (
    new Set(
      stockCodes,
    ).size !==
    EXPECTED_REFRESHABLE
  ) {
    throw new Error(
      "DUPLICATE_REFRESHABLE_STOCK_CODE",
    );
  }

  for (
    const plan of
    input.refreshablePlan
  ) {
    if (
      !plan.refreshStart ||
      !plan.refreshEnd
    ) {
      throw new Error(
        `REFRESH_RANGE_REQUIRED:${plan.stockCode}`,
      );
    }

    if (
      plan
        .unadjustedRowsThroughSnapshot !==
      0
    ) {
      throw new Error(
        `INPUT_UNADJUSTED_ROWS_PRESENT:${plan.stockCode}`,
      );
    }

    if (
      plan.chunkDays !==
      CHUNK_DAYS
    ) {
      throw new Error(
        `INPUT_CHUNK_DAYS_MISMATCH:${plan.stockCode}:${plan.chunkDays}`,
      );
    }
  }

  const {
    url,
    key,
  } =
    requireEnv();

  let databaseReads =
    0;

  let syncInvocations =
    0;

  /*
   * Guard 1:
   * every refreshable stock must still exist in the exact surface used by
   * syncDailyBars(): public.stocks with is_active=true.
   */
  const activeResult =
    await requestArray(
      `${url}/rest/v1/stocks` +
        `?select=${encodeURIComponent("stock_code,is_active")}` +
        `&stock_code=in.${encodeURIComponent(postgrestIn(stockCodes))}` +
        `&is_active=eq.true`,
      key,
    );

  databaseReads +=
    1;

  const activeCodes =
    new Set(
      activeResult
        .rows
        .map(
          (row) =>
            String(
              row.stock_code ??
              "",
            ),
        )
        .filter(
          Boolean,
        ),
    );

  const missingActiveStocks =
    stockCodes
      .filter(
        (stockCode) =>
          !activeCodes
            .has(
              stockCode,
            ),
      );

  if (
    missingActiveStocks
      .length >
    0
  ) {
    const error =
      new Error(
        "SYNC_DAILY_BARS_ACTIVE_STOCK_SURFACE_DRIFT",
      );

    (error as any)
      .details = {
      missingActiveStocks,
    };

    throw error;
  }

  /*
   * Guard 2:
   * Re-read every target window before any KIS write.
   * Earliest boundary must still equal the preflight refreshStart and no
   * unadjusted canonical row may have appeared.
   */
  const beforeByStock =
    new Map<
      string,
      WindowState
    >();

  for (
    const plan of
    input.refreshablePlan
  ) {
    const before =
      await readWindowState(
        url,
        key,
        plan,
      );

    databaseReads +=
      3;

    if (
      before.rowCount <=
      0
    ) {
      throw new Error(
        `PRE_WRITE_CANONICAL_WINDOW_DISAPPEARED:${plan.stockCode}`,
      );
    }

    if (
      before
        .unadjustedCount !==
      0
    ) {
      throw new Error(
        `PRE_WRITE_UNADJUSTED_ROWS_DETECTED:${plan.stockCode}:${before.unadjustedCount}`,
      );
    }

    if (
      before
        .earliestDate !==
      plan.refreshStart
    ) {
      throw new Error(
        `PRE_WRITE_START_BOUNDARY_DRIFT:${plan.stockCode}:${before.earliestDate}:${plan.refreshStart}`,
      );
    }

    beforeByStock.set(
      plan.stockCode,
      before,
    );
  }

  /*
   * Resume state.
   * A previously completed stock is skipped only when it belongs to the same
   * manifest fingerprint.
   */
  let progress:
    ProgressFile;

  if (
    fs.existsSync(
      outputFile,
    )
  ) {
    const existing =
      readJson<ProgressFile>(
        outputFile,
      );

    if (
      existing.version !==
      VERSION
    ) {
      throw new Error(
        "EXISTING_PROGRESS_VERSION_MISMATCH",
      );
    }

    if (
      (
        existing.source
          ?.inputFingerprint ??
        null
      ) !==
      (
        input.outputFingerprint ??
        null
      )
    ) {
      throw new Error(
        "EXISTING_PROGRESS_INPUT_FINGERPRINT_MISMATCH",
      );
    }

    progress =
      existing;
  } else {
    progress = {
      version:
        VERSION,

      status:
        "RUNNING",

      source: {
        inputVersion:
          input.version,

        inputFingerprint:
          input.outputFingerprint ??
          null,
      },

      policy: {
        adjustedPrice:
          ADJUSTED_PRICE,

        kisMode:
          "FID_ORG_ADJ_PRC=0",

        chunkDays:
          CHUNK_DAYS,

        perStockRange:
          "EXISTING_REFRESH_START_TO_2026_10_01",

        canonicalBarWriter:
          "lib/market/sync-daily-bars.ts",

        upsertIdentity:
          "stock_code,trading_date",

        corporateActionFactorApplication:
          "NEVER",

        noCanonicalBarSurface:
          [
            "900110",
            "900270",
          ],
      },

      completed:
        [],

      failed:
        null,

      safety: {
        explicitApplyFlag:
          true,

        databaseReads:
          0,

        syncInvocations:
          0,

        rowByRowFactorApplication:
          false,

        corporateActionFactorsAppliedToCanonicalBars:
          0,

        automaticDeleteRollbackUsed:
          false,

        corporateActionCoverageWindowAdvanced:
          false,
      },

      outputFile:
        path
          .relative(
            root,
            outputFile,
          )
          .replaceAll(
            "\\",
            "/",
          ),
    };
  }

  const completedCodes =
    new Set(
      progress.completed
        .filter(
          (row) =>
            row.status ===
            "SUCCESS",
        )
        .map(
          (row) =>
            row.stockCode,
        ),
    );

  /*
   * Actual refresh.
   * One syncDailyBars invocation per stock preserves that stock's individual
   * existing-history start boundary.
   */
  for (
    let index = 0;
    index <
    input.refreshablePlan
      .length;
    index += 1
  ) {
    const plan =
      input.refreshablePlan[
        index
      ];

    if (
      completedCodes.has(
        plan.stockCode,
      )
    ) {
      console.log(
        `REFRESH_SKIP_ALREADY_COMPLETE ${index + 1}/${EXPECTED_REFRESHABLE} stock=${plan.stockCode}`,
      );

      continue;
    }

    const before =
      beforeByStock.get(
        plan.stockCode,
      );

    if (!before) {
      throw new Error(
        `PRE_WRITE_STATE_MISSING:${plan.stockCode}`,
      );
    }

    console.log(
      [
        "REFRESH_START",
        `${index + 1}/${EXPECTED_REFRESHABLE}`,
        `stock=${plan.stockCode}`,
        `action=${plan.actionType}`,
        `effective=${plan.effectiveDate}`,
        `range=${plan.refreshStart}..${plan.refreshEnd}`,
        `estimatedKisRequests=${plan.estimatedKisRequests}`,
      ].join(
        " ",
      ),
    );

    try {
      const result =
        await syncDailyBars({
          stockCodes: [
            plan.stockCode,
          ],

          startDate:
            plan.refreshStart,

          endDate:
            plan.refreshEnd,

          adjustedPrice:
            ADJUSTED_PRICE,

          chunkDays:
            CHUNK_DAYS,
        });

      syncInvocations +=
        1;

      const failures =
        getFailures(
          result,
        );

      if (
        failures.length >
        0
      ) {
        const error =
          new Error(
            `SYNC_DAILY_BARS_REPORTED_FAILURES:${plan.stockCode}:${failures.length}`,
          );

        (error as any)
          .details = {
          failures,
          result,
        };

        throw error;
      }

      const after =
        await readWindowState(
          url,
          key,
          plan,
        );

      databaseReads +=
        3;

      if (
        after.rowCount <=
        0
      ) {
        throw new Error(
          `POST_REFRESH_CANONICAL_WINDOW_EMPTY:${plan.stockCode}`,
        );
      }

      if (
        after
          .unadjustedCount !==
        0
      ) {
        throw new Error(
          `POST_REFRESH_UNADJUSTED_ROWS_DETECTED:${plan.stockCode}:${after.unadjustedCount}`,
        );
      }

      if (
        after
          .earliestDate !==
        plan.refreshStart
      ) {
        throw new Error(
          `POST_REFRESH_START_BOUNDARY_CHANGED:${plan.stockCode}:${after.earliestDate}:${plan.refreshStart}`,
        );
      }

      if (
        after.latestDate &&
        after.latestDate >
          plan.refreshEnd
      ) {
        throw new Error(
          `POST_REFRESH_END_BOUNDARY_EXCEEDED:${plan.stockCode}:${after.latestDate}:${plan.refreshEnd}`,
        );
      }

      const stockResult:
        StockResult = {
        stockCode:
          plan.stockCode,

        providerEventId:
          plan.providerEventId,

        actionType:
          plan.actionType,

        effectiveDate:
          plan.effectiveDate,

        refreshStart:
          plan.refreshStart,

        refreshEnd:
          plan.refreshEnd,

        estimatedKisRequests:
          plan.estimatedKisRequests,

        syncReceivedRows:
          getSyncNumber(
            result,
            "receivedRows",
          ),

        syncSavedRows:
          getSyncNumber(
            result,
            "savedRows",
          ),

        syncFailureCount:
          0,

        before,

        after,

        rowCountDelta:
          after.rowCount -
          before.rowCount,

        earliestBoundaryChanged:
          after.earliestDate !==
          before.earliestDate,

        latestBoundaryChanged:
          after.latestDate !==
          before.latestDate,

        status:
          "SUCCESS",
      };

      progress.completed =
        [
          ...progress.completed
            .filter(
              (row) =>
                row.stockCode !==
                plan.stockCode,
            ),
          stockResult,
        ]
          .sort(
            (a, b) =>
              a.stockCode
                .localeCompare(
                  b.stockCode,
                ),
          );

      progress.status =
        "RUNNING";

      progress.failed =
        null;

      progress.safety = {
        ...progress.safety,

        databaseReads,

        syncInvocations:
          syncInvocations,

        completedStocks:
          progress.completed
            .length,

        requestedWindowExpansion:
          false,

        corporateActionCoverageWindowAdvanced:
          false,
      };

      progress.outputFingerprint =
        buildFingerprint(
          progress,
        );

      atomicSaveJson(
        outputFile,
        progress,
      );

      completedCodes.add(
        plan.stockCode,
      );

      console.log(
        [
          "REFRESH_SUCCESS",
          `${index + 1}/${EXPECTED_REFRESHABLE}`,
          `stock=${plan.stockCode}`,
          `beforeRows=${before.rowCount}`,
          `afterRows=${after.rowCount}`,
          `rowDelta=${after.rowCount - before.rowCount}`,
          `latestBefore=${before.latestDate ?? "-"}`,
          `latestAfter=${after.latestDate ?? "-"}`,
        ].join(
          " ",
        ),
      );
    } catch (
      error
    ) {
      progress.status =
        "KIS_ADJUSTED_HISTORY_REFRESH_APPLY_ABORTED";

      progress.failed = {
        stockCode:
          plan.stockCode,

        providerEventId:
          plan.providerEventId,

        actionType:
          plan.actionType,

        effectiveDate:
          plan.effectiveDate,

        refreshStart:
          plan.refreshStart,

        refreshEnd:
          plan.refreshEnd,

        error:
          String(
            (error as any)
              ?.message ??
            error,
          ),

        details:
          (error as any)
            ?.details ??
          null,
      };

      progress.safety = {
        ...progress.safety,

        databaseReads,

        syncInvocations,

        completedStocks:
          progress.completed
            .length,

        automaticDeleteRollbackUsed:
          false,

        resumeSafe:
          true,
      };

      progress.outputFingerprint =
        buildFingerprint(
          progress,
        );

      atomicSaveJson(
        outputFile,
        progress,
      );

      throw error;
    }
  }

  if (
    progress.completed
      .length !==
    EXPECTED_REFRESHABLE
  ) {
    throw new Error(
      `FINAL_COMPLETED_STOCK_COUNT_MISMATCH:${progress.completed.length}`,
    );
  }

  const anyUnadjusted =
    progress.completed
      .filter(
        (row) =>
          row.after
            .unadjustedCount !==
          0,
      );

  const anyStartBoundaryChange =
    progress.completed
      .filter(
        (row) =>
          row
            .earliestBoundaryChanged,
      );

  if (
    anyUnadjusted
      .length >
      0
  ) {
    throw new Error(
      `FINAL_UNADJUSTED_CANONICAL_ROWS:${anyUnadjusted.length}`,
    );
  }

  if (
    anyStartBoundaryChange
      .length >
      0
  ) {
    throw new Error(
      `FINAL_START_BOUNDARY_CHANGE:${anyStartBoundaryChange.length}`,
    );
  }

  progress.status =
    "KIS_ADJUSTED_HISTORY_REFRESH_APPLY_COMPLETE";

  progress.failed =
    null;

  progress.safety = {
    ...progress.safety,

    databaseReads,

    syncInvocations,

    completedStocks:
      progress.completed
        .length,

    noSurfaceStocks:
      EXPECTED_NO_SURFACE,

    adjustedPriceAlwaysTrue:
      true,

    corporateActionFactorsAppliedToCanonicalBars:
      0,

    automaticDeleteRollbackUsed:
      false,

    resumeSafe:
      true,

    corporateActionCoverageWindowAdvanced:
      false,
  };

  progress.outputFingerprint =
    buildFingerprint(
      progress,
    );

  atomicSaveJson(
    outputFile,
    progress,
  );

  const totalBeforeRows =
    progress.completed
      .reduce(
        (sum, row) =>
          sum +
          row.before
            .rowCount,
        0,
      );

  const totalAfterRows =
    progress.completed
      .reduce(
        (sum, row) =>
          sum +
          row.after
            .rowCount,
        0,
      );

  const latestBoundaryChangedStocks =
    progress.completed
      .filter(
        (row) =>
          row
            .latestBoundaryChanged,
      )
      .map(
        (row) =>
          row.stockCode,
      );

  console.log(
    JSON.stringify(
      {
        status:
          progress.status,

        version:
          VERSION,

        refreshableStocks:
          EXPECTED_REFRESHABLE,

        completedStocks:
          progress.completed
            .length,

        noCanonicalBarSurfaceStocks:
          EXPECTED_NO_SURFACE,

        adjustedPrice:
          true,

        kisMode:
          "FID_ORG_ADJ_PRC=0",

        chunkDays:
          CHUNK_DAYS,

        totalBeforeRows,

        totalAfterRows,

        rowCountDelta:
          totalAfterRows -
          totalBeforeRows,

        latestBoundaryChangedStocks,

        stocksWithUnadjustedRowsAfter:
          0,

        stocksWithStartBoundaryChange:
          0,

        syncInvocations,

        corporateActionFactorsAppliedToCanonicalBars:
          0,

        automaticDeleteRollbackUsed:
          false,

        nextGate:
          "BUILD_POST_REFRESH_16_STOCK_VENDOR_ADJUSTED_VERIFICATION",

        outputFile:
          progress.outputFile,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(
    (
      error,
    ) => {
      console.error(
        JSON.stringify(
          {
            status:
              "KIS_ADJUSTED_HISTORY_REFRESH_APPLY_ABORTED",

            version:
              VERSION,

            error:
              String(
                error?.message ??
                error,
              ),

            details:
              (error as any)
                ?.details ??
              null,

            databaseSafety:
              "UPSERT_ONLY_RESUME_SAFE_NO_AUTOMATIC_DELETE",

            corporateActionFactorsAppliedToCanonicalBars:
              0,
          },
          null,
          2,
        ),
      );

      process.exitCode =
        1;
    },
  );
