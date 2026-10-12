/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  getDomesticDailyStockPrices,
  getKisAccessToken,
  type KisDomesticDailyPriceOutput,
} from "../lib/kis/client";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const VERSION =
  "V9_8_11_11_1_16_STOCK_DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY";

const INPUT_VERSION =
  "V9_8_11_10_2_1_RATIO_REFRESH_COVERAGE_DISPOSITION_REPAIR";

const EXPECTED_REFRESHABLE = 16;
const EXPECTED_NO_SURFACE = 2;
const CHUNK_DAYS = 90;
const REQUEST_DELAY_MS = 1500;
const ADJUSTED_PRICE = true;

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
  expectedChunks: number;
  completedChunks: number;
  receivedRows: number;
  convertedRows: number;
  upsertedRows: number;
  emptyChunks: number;
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
    | "DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY_COMPLETE"
    | "DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY_ABORTED";
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
      .readFileSync(file, "utf8")
      .replace(/^\uFEFF/, ""),
  ) as T;
}

function atomicSaveJson(
  file: string,
  value: unknown,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true,
    },
  );

  const tmp = `${file}.tmp`;

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
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function sleep(
  ms: number,
) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>(
    (resolve) =>
      setTimeout(
        resolve,
        ms,
      ),
  );
}

function parseSqlDate(
  value: string,
) {
  const date =
    new Date(
      `${value}T00:00:00Z`,
    );

  if (
    !Number.isFinite(
      date.getTime(),
    )
  ) {
    throw new Error(
      `INVALID_SQL_DATE:${value}`,
    );
  }

  return date;
}

function formatSqlDate(
  date: Date,
) {
  return date
    .toISOString()
    .slice(0, 10);
}

function toCompactDate(
  sqlDate: string,
) {
  return sqlDate
    .replaceAll("-", "");
}

function toSqlDate(
  compactDate: string,
) {
  if (
    !/^\d{8}$/.test(
      compactDate,
    )
  ) {
    return null;
  }

  return (
    `${compactDate.slice(0, 4)}-` +
    `${compactDate.slice(4, 6)}-` +
    `${compactDate.slice(6, 8)}`
  );
}

function createDateChunks(
  startDate: string,
  endDate: string,
  chunkDays: number,
) {
  const start =
    parseSqlDate(startDate);

  const end =
    parseSqlDate(endDate);

  if (
    start.getTime() >
    end.getTime()
  ) {
    throw new Error(
      `INVALID_DATE_RANGE:${startDate}:${endDate}`,
    );
  }

  const chunks:
    {
      startDate: string;
      endDate: string;
    }[] = [];

  let cursor =
    new Date(start);

  while (
    cursor.getTime() <=
    end.getTime()
  ) {
    const chunkStart =
      new Date(cursor);

    const chunkEnd =
      new Date(cursor);

    chunkEnd.setUTCDate(
      chunkEnd.getUTCDate() +
        chunkDays -
        1,
    );

    if (
      chunkEnd.getTime() >
      end.getTime()
    ) {
      chunkEnd.setTime(
        end.getTime(),
      );
    }

    chunks.push({
      startDate:
        formatSqlDate(
          chunkStart,
        ),

      endDate:
        formatSqlDate(
          chunkEnd,
        ),
    });

    cursor =
      new Date(
        chunkEnd,
      );

    cursor.setUTCDate(
      cursor.getUTCDate() +
        1,
    );
  }

  return chunks;
}

function toNumber(
  value:
    | string
    | number
    | null
    | undefined,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function convertDailyBar(
  stockCode: string,
  row: KisDomesticDailyPriceOutput,
) {
  const tradingDate =
    toSqlDate(
      row.stck_bsop_date,
    );

  const open =
    toNumber(
      row.stck_oprc,
    );

  const high =
    toNumber(
      row.stck_hgpr,
    );

  const low =
    toNumber(
      row.stck_lwpr,
    );

  const close =
    toNumber(
      row.stck_clpr,
    );

  const volume =
    toNumber(
      row.acml_vol,
    );

  const tradingValue =
    toNumber(
      row.acml_tr_pbmn,
    );

  if (
    !tradingDate ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null
  ) {
    return null;
  }

  const now =
    new Date()
      .toISOString();

  return {
    stock_code:
      stockCode,

    trading_date:
      tradingDate,

    open_price:
      open,

    high_price:
      high,

    low_price:
      low,

    close_price:
      close,

    volume,

    trading_value:
      tradingValue,

    source:
      "KIS_DAILY_V8_3",

    adjusted_price:
      true,

    raw_payload:
      row,

    collected_at:
      now,

    updated_at:
      now,
  };
}

function filterToChunk(
  rows:
    ReturnType<
      typeof convertDailyBar
    >[],
  startDate: string,
  endDate: string,
) {
  return rows
    .filter(
      (
        row,
      ): row is NonNullable<
        ReturnType<
          typeof convertDailyBar
        >
      > =>
        row !==
        null,
    )
    .filter(
      (row) =>
        row.trading_date >=
          startDate &&
        row.trading_date <=
          endDate,
    );
}

async function readWindowState(
  supabase:
    ReturnType<
      typeof createSupabaseServerClient
    >,
  plan: RefreshPlanRow,
) {
  const {
    data,
    error,
    count,
  } =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        `
          trading_date,
          adjusted_price,
          source
        `,
        {
          count:
            "exact",
        },
      )
      .eq(
        "stock_code",
        plan.stockCode,
      )
      .gte(
        "trading_date",
        plan.refreshStart,
      )
      .lte(
        "trading_date",
        plan.refreshEnd,
      )
      .order(
        "trading_date",
        {
          ascending: true,
        },
      );

  if (error) {
    throw new Error(
      `READ_WINDOW_FAILED:${plan.stockCode}:${error.message}`,
    );
  }

  const rows =
    data ?? [];

  const earliest =
    rows[0] ??
    null;

  const latest =
    rows.length >
    0
      ? rows[
          rows.length -
          1
        ]
      : null;

  const unadjustedCount =
    rows.filter(
      (row) =>
        row.adjusted_price !==
        true,
    ).length;

  return {
    stockCode:
      plan.stockCode,

    rowCount:
      count ??
      rows.length,

    unadjustedCount,

    earliestDate:
      earliest
        ?.trading_date ??
      null,

    latestDate:
      latest
        ?.trading_date ??
      null,
  } satisfies WindowState;
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
              row.completedChunks,
              row.receivedRows,
              row.upsertedRows,
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
      "opendart-corporate-action-ratio-refresh-direct-apply-v9-8-11-11-1.json",
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
      plan.unadjustedRowsThroughSnapshot !==
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

  const supabase =
    createSupabaseServerClient();

  /*
   * Guard 1:
   * Verify the current master surface actually used by V8.3:
   * stock_universe_securities.
   */
  const {
    data:
      universeRows,
    error:
      universeError,
  } =
    await supabase
      .from(
        "stock_universe_securities",
      )
      .select(
        `
          stock_code,
          security_type,
          market,
          metadata
        `,
      )
      .in(
        "stock_code",
        stockCodes,
      );

  if (
    universeError
  ) {
    throw new Error(
      `UNIVERSE_READ_FAILED:${universeError.message}`,
    );
  }

  const universeByCode =
    new Map(
      (
        universeRows ??
        []
      ).map(
        (row) => [
          row.stock_code,
          row,
        ],
      ),
    );

  const missingUniverse =
    stockCodes.filter(
      (stockCode) =>
        !universeByCode.has(
          stockCode,
        ),
    );

  if (
    missingUniverse.length >
    0
  ) {
    throw new Error(
      `UNIVERSE_TARGET_MISSING:${missingUniverse.join(",")}`,
    );
  }

  const nonCommonTargets =
    stockCodes.filter(
      (stockCode) =>
        universeByCode
          .get(
            stockCode,
          )
          ?.security_type !==
        "COMMON",
    );

  if (
    nonCommonTargets.length >
    0
  ) {
    throw new Error(
      `NON_COMMON_REFRESH_TARGET:${nonCommonTargets.join(",")}`,
    );
  }

  /*
   * Guard 2:
   * Re-read target windows before any KIS request.
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
        supabase,
        plan,
      );

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
        marketMaster:
          "stock_universe_securities",

        securityType:
          "COMMON",

        adjustedPrice:
          ADJUSTED_PRICE,

        kisMode:
          "FID_ORG_ADJ_PRC=0",

        source:
          "KIS_DAILY_V8_3",

        chunkDays:
          CHUNK_DAYS,

        requestDelayMs:
          REQUEST_DELAY_MS,

        perStockRange:
          "EXISTING_CANONICAL_START_TO_2026_10_01",

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

        kisRequests:
          0,

        upsertRequests:
          0,

        corporateActionFactorsAppliedToCanonicalBars:
          0,

        automaticDeleteRollbackUsed:
          false,

        resumeSafe:
          true,

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

  let kisRequests =
    Number(
      progress.safety
        ?.kisRequests ??
      0,
    );

  let upsertRequests =
    Number(
      progress.safety
        ?.upsertRequests ??
      0,
    );

  const accessToken =
    await getKisAccessToken();

  for (
    let stockIndex = 0;
    stockIndex <
    input.refreshablePlan
      .length;
    stockIndex += 1
  ) {
    const plan =
      input.refreshablePlan[
        stockIndex
      ];

    if (
      completedCodes.has(
        plan.stockCode,
      )
    ) {
      console.log(
        `REFRESH_SKIP_ALREADY_COMPLETE ${stockIndex + 1}/${EXPECTED_REFRESHABLE} stock=${plan.stockCode}`,
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

    const chunks =
      createDateChunks(
        plan.refreshStart,
        plan.refreshEnd,
        CHUNK_DAYS,
      );

    console.log(
      [
        "REFRESH_START",
        `${stockIndex + 1}/${EXPECTED_REFRESHABLE}`,
        `stock=${plan.stockCode}`,
        `action=${plan.actionType}`,
        `effective=${plan.effectiveDate}`,
        `range=${plan.refreshStart}..${plan.refreshEnd}`,
        `chunks=${chunks.length}`,
      ].join(" "),
    );

    let receivedRows =
      0;

    let convertedRows =
      0;

    let upsertedRows =
      0;

    let emptyChunks =
      0;

    try {
      for (
        let chunkIndex = 0;
        chunkIndex <
        chunks.length;
        chunkIndex += 1
      ) {
        const chunk =
          chunks[
            chunkIndex
          ];

        const response =
          await getDomesticDailyStockPrices(
            {
              stockCode:
                plan.stockCode,

              startDate:
                toCompactDate(
                  chunk.startDate,
                ),

              endDate:
                toCompactDate(
                  chunk.endDate,
                ),

              period:
                "D",

              adjustedPrice:
                true,
            },
            accessToken,
          );

        kisRequests +=
          1;

        if (
          response.rt_cd !==
          "0"
        ) {
          const error =
            new Error(
              `KIS_DAILY_REQUEST_FAILED:${plan.stockCode}:${response.msg_cd}:${response.msg1}`,
            );

          (error as any)
            .details = {
            stockCode:
              plan.stockCode,

            chunk,

            rt_cd:
              response.rt_cd,

            msg_cd:
              response.msg_cd,

            msg1:
              response.msg1,
          };

          throw error;
        }

        const rawRows =
          response.output2 ??
          [];

        receivedRows +=
          rawRows.length;

        const converted =
          filterToChunk(
            rawRows.map(
              (row) =>
                convertDailyBar(
                  plan.stockCode,
                  row,
                ),
            ),
            chunk.startDate,
            chunk.endDate,
          );

        convertedRows +=
          converted.length;

        if (
          converted.length ===
          0
        ) {
          emptyChunks +=
            1;
        } else {
          const {
            error:
              saveError,
          } =
            await supabase
              .from(
                "market_daily_bars",
              )
              .upsert(
                converted,
                {
                  onConflict:
                    "stock_code,trading_date",
                },
              );

          upsertRequests +=
            1;

          if (
            saveError
          ) {
            throw new Error(
              `MARKET_DAILY_BAR_UPSERT_FAILED:${plan.stockCode}:${saveError.message}`,
            );
          }

          upsertedRows +=
            converted.length;
        }

        console.log(
          [
            "REFRESH_CHUNK",
            `stock=${plan.stockCode}`,
            `${chunkIndex + 1}/${chunks.length}`,
            `range=${chunk.startDate}..${chunk.endDate}`,
            `raw=${rawRows.length}`,
            `converted=${converted.length}`,
          ].join(" "),
        );

        if (
          !(
            stockIndex ===
              input.refreshablePlan
                .length -
                1 &&
            chunkIndex ===
              chunks.length -
                1
          )
        ) {
          await sleep(
            REQUEST_DELAY_MS,
          );
        }
      }

      const after =
        await readWindowState(
          supabase,
          plan,
        );

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

      const result:
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

        expectedChunks:
          chunks.length,

        completedChunks:
          chunks.length,

        receivedRows,

        convertedRows,

        upsertedRows,

        emptyChunks,

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
          result,
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

        kisRequests,

        upsertRequests,

        completedStocks:
          progress.completed
            .length,

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

      completedCodes.add(
        plan.stockCode,
      );

      console.log(
        [
          "REFRESH_SUCCESS",
          `${stockIndex + 1}/${EXPECTED_REFRESHABLE}`,
          `stock=${plan.stockCode}`,
          `received=${receivedRows}`,
          `upserted=${upsertedRows}`,
          `beforeRows=${before.rowCount}`,
          `afterRows=${after.rowCount}`,
          `rowDelta=${after.rowCount - before.rowCount}`,
        ].join(" "),
      );
    } catch (
      error
    ) {
      progress.status =
        "DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY_ABORTED";

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

        receivedRows,

        convertedRows,

        upsertedRows,

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

        kisRequests,

        upsertRequests,

        completedStocks:
          progress.completed
            .length,

        corporateActionFactorsAppliedToCanonicalBars:
          0,

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
    "DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY_COMPLETE";

  progress.failed =
    null;

  progress.safety = {
    ...progress.safety,

    kisRequests,

    upsertRequests,

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

  const totalReceivedRows =
    progress.completed
      .reduce(
        (sum, row) =>
          sum +
          row.receivedRows,
        0,
      );

  const totalUpsertedRows =
    progress.completed
      .reduce(
        (sum, row) =>
          sum +
          row.upsertedRows,
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

        marketMaster:
          "stock_universe_securities",

        securityType:
          "COMMON",

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

        requestDelayMs:
          REQUEST_DELAY_MS,

        kisRequests,

        upsertRequests,

        totalReceivedRows,

        totalUpsertedRows,

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
              "DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY_ABORTED",

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
