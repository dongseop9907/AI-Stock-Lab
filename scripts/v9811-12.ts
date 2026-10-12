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
  "V9_8_11_12_POST_REFRESH_16_STOCK_VENDOR_ADJUSTED_VERIFICATION";

const INPUT_VERSION =
  "V9_8_11_11_1_16_STOCK_DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY";

const EXPECTED_STOCKS = 16;
const SNAPSHOT_END = "2026-10-01";
const REQUEST_DELAY_MS = 1500;
const PROBE_BEFORE_DAYS = 45;
const PROBE_AFTER_DAYS = 15;

interface ApplyStockRow {
  stockCode: string;
  providerEventId: string;
  actionType: string;
  effectiveDate: string;
  refreshStart: string;
  refreshEnd: string;
  after: {
    rowCount: number;
    unadjustedCount: number;
    earliestDate: string | null;
    latestDate: string | null;
  };
  status: "SUCCESS";
}

interface ApplyFile {
  version: string;
  status: string;
  completed: ApplyStockRow[];
  outputFingerprint?: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(
    fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""),
  ) as T;
}

function atomicSaveJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function addDays(sqlDate: string, days: number) {
  const date = new Date(`${sqlDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`INVALID_DATE:${sqlDate}`);
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toCompact(sqlDate: string) {
  return sqlDate.replaceAll("-", "");
}

function toSql(compact: string) {
  if (!/^\d{8}$/.test(compact)) {
    return null;
  }
  return (
    `${compact.slice(0, 4)}-` +
    `${compact.slice(4, 6)}-` +
    `${compact.slice(6, 8)}`
  );
}

function toNumber(
  value: string | number | null | undefined,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeVendorRow(row: KisDomesticDailyPriceOutput) {
  const tradingDate = toSql(row.stck_bsop_date);

  if (!tradingDate) {
    return null;
  }

  return {
    tradingDate,
    open: toNumber(row.stck_oprc),
    high: toNumber(row.stck_hgpr),
    low: toNumber(row.stck_lwpr),
    close: toNumber(row.stck_clpr),
    volume: toNumber(row.acml_vol),
    tradingValue: toNumber(row.acml_tr_pbmn),
  };
}

function sameNumber(a: unknown, b: unknown) {
  const x = toNumber(a as any);
  const y = toNumber(b as any);

  if (x === null || y === null) {
    return x === y;
  }

  return Math.abs(x - y) <= 1e-9;
}

async function main() {
  const root = path.resolve(process.cwd());

  const inputFile = path.join(
    root,
    "logs",
    "opendart-corporate-action-ratio-refresh-direct-apply-v9-8-11-11-1.json",
  );

  const outputFile = path.join(
    root,
    "logs",
    "opendart-corporate-action-post-refresh-vendor-verification-v9-8-11-12.json",
  );

  if (!fs.existsSync(inputFile)) {
    throw new Error(`INPUT_NOT_FOUND:${path.basename(inputFile)}`);
  }

  const input = readJson<ApplyFile>(inputFile);

  if (input.version !== INPUT_VERSION) {
    throw new Error("INPUT_VERSION_MISMATCH");
  }

  if (
    input.status !==
    "DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY_COMPLETE"
  ) {
    throw new Error("REFRESH_APPLY_NOT_COMPLETE");
  }

  if (
    !Array.isArray(input.completed) ||
    input.completed.length !== EXPECTED_STOCKS
  ) {
    throw new Error("EXPECTED_16_COMPLETED_STOCKS");
  }

  const stockCodes = input.completed.map((row) => row.stockCode);

  if (new Set(stockCodes).size !== EXPECTED_STOCKS) {
    throw new Error("DUPLICATE_COMPLETED_STOCK_CODE");
  }

  const supabase = createSupabaseServerClient();
  const accessToken = await getKisAccessToken();

  const results: Record<string, unknown>[] = [];
  let kisRequests = 0;

  for (
    let index = 0;
    index < input.completed.length;
    index += 1
  ) {
    const plan = input.completed[index];

    const requestedStart = addDays(
      plan.effectiveDate,
      -PROBE_BEFORE_DAYS,
    );

    const rawEnd = addDays(
      plan.effectiveDate,
      PROBE_AFTER_DAYS,
    );

    const requestedEnd =
      rawEnd < SNAPSHOT_END
        ? rawEnd
        : SNAPSHOT_END;

    const probeStart =
      requestedStart < plan.refreshStart
        ? plan.refreshStart
        : requestedStart;

    const probeEnd =
      requestedEnd > plan.refreshEnd
        ? plan.refreshEnd
        : requestedEnd;

    if (probeStart > probeEnd) {
      throw new Error(
        `INVALID_PROBE_RANGE:${plan.stockCode}:${probeStart}:${probeEnd}`,
      );
    }

    console.log(
      [
        "VENDOR_VERIFY_START",
        `${index + 1}/${EXPECTED_STOCKS}`,
        `stock=${plan.stockCode}`,
        `effective=${plan.effectiveDate}`,
        `range=${probeStart}..${probeEnd}`,
      ].join(" "),
    );

    const response =
      await getDomesticDailyStockPrices(
        {
          stockCode: plan.stockCode,
          startDate: toCompact(probeStart),
          endDate: toCompact(probeEnd),
          period: "D",
          adjustedPrice: true,
        },
        accessToken,
      );

    kisRequests += 1;

    if (response.rt_cd !== "0") {
      const error = new Error(
        `KIS_VENDOR_VERIFY_FAILED:${plan.stockCode}:${response.msg_cd}:${response.msg1}`,
      );

      (error as any).details = {
        stockCode: plan.stockCode,
        probeStart,
        probeEnd,
        rt_cd: response.rt_cd,
        msg_cd: response.msg_cd,
        msg1: response.msg1,
      };

      throw error;
    }

    const vendorRows =
      (response.output2 ?? [])
        .map(normalizeVendorRow)
        .filter(
          (row): row is NonNullable<typeof row> =>
            row !== null &&
            row.tradingDate >= probeStart &&
            row.tradingDate <= probeEnd,
        )
        .sort((a, b) =>
          a.tradingDate.localeCompare(b.tradingDate),
        );

    const {
      data: dbRows,
      error: dbError,
    } =
      await supabase
        .from("market_daily_bars")
        .select(`
          trading_date,
          open_price,
          high_price,
          low_price,
          close_price,
          volume,
          trading_value,
          source,
          adjusted_price,
          raw_payload
        `)
        .eq("stock_code", plan.stockCode)
        .gte("trading_date", probeStart)
        .lte("trading_date", probeEnd)
        .order("trading_date", {
          ascending: true,
        });

    if (dbError) {
      throw new Error(
        `DB_VENDOR_VERIFY_READ_FAILED:${plan.stockCode}:${dbError.message}`,
      );
    }

    const canonicalRows = dbRows ?? [];

    const dbByDate =
      new Map(
        canonicalRows.map((row) => [
          row.trading_date,
          row,
        ]),
      );

    const vendorByDate =
      new Map(
        vendorRows.map((row) => [
          row.tradingDate,
          row,
        ]),
      );

    const missingInDb: string[] = [];
    const missingAtVendor: string[] = [];
    const valueMismatches: Record<string, unknown>[] = [];
    const sourceMismatches: Record<string, unknown>[] = [];
    const adjustedFlagMismatches: string[] = [];

    for (const vendor of vendorRows) {
      const db = dbByDate.get(vendor.tradingDate);

      if (!db) {
        missingInDb.push(vendor.tradingDate);
        continue;
      }

      const mismatchedFields: string[] = [];

      if (!sameNumber(db.open_price, vendor.open)) {
        mismatchedFields.push("open");
      }
      if (!sameNumber(db.high_price, vendor.high)) {
        mismatchedFields.push("high");
      }
      if (!sameNumber(db.low_price, vendor.low)) {
        mismatchedFields.push("low");
      }
      if (!sameNumber(db.close_price, vendor.close)) {
        mismatchedFields.push("close");
      }
      if (!sameNumber(db.volume, vendor.volume)) {
        mismatchedFields.push("volume");
      }
      if (!sameNumber(db.trading_value, vendor.tradingValue)) {
        mismatchedFields.push("trading_value");
      }

      if (mismatchedFields.length > 0) {
        valueMismatches.push({
          tradingDate: vendor.tradingDate,
          fields: mismatchedFields,
        });
      }

      if (
        db.source !== "KIS_DAILY_V8_3"
      ) {
        sourceMismatches.push({
          tradingDate: vendor.tradingDate,
          source: db.source,
        });
      }

      if (
        db.adjusted_price !== true
      ) {
        adjustedFlagMismatches.push(
          vendor.tradingDate,
        );
      }
    }

    for (const db of canonicalRows) {
      if (
        !vendorByDate.has(
          db.trading_date,
        )
      ) {
        missingAtVendor.push(
          db.trading_date,
        );
      }
    }

    const blockerCount =
      missingInDb.length +
      missingAtVendor.length +
      valueMismatches.length +
      sourceMismatches.length +
      adjustedFlagMismatches.length;

    const rowStatus =
      blockerCount === 0
        ? "MATCH"
        : "MISMATCH";

    results.push({
      stockCode: plan.stockCode,
      providerEventId: plan.providerEventId,
      actionType: plan.actionType,
      effectiveDate: plan.effectiveDate,
      probeStart,
      probeEnd,
      vendorRows: vendorRows.length,
      canonicalRows: canonicalRows.length,
      missingInDb,
      missingAtVendor,
      valueMismatches,
      sourceMismatches,
      adjustedFlagMismatches,
      status: rowStatus,
    });

    console.log(
      [
        "VENDOR_VERIFY_RESULT",
        `${index + 1}/${EXPECTED_STOCKS}`,
        `stock=${plan.stockCode}`,
        `vendorRows=${vendorRows.length}`,
        `dbRows=${canonicalRows.length}`,
        `missingInDb=${missingInDb.length}`,
        `missingAtVendor=${missingAtVendor.length}`,
        `valueMismatches=${valueMismatches.length}`,
        `sourceMismatches=${sourceMismatches.length}`,
        `adjustedFlagMismatches=${adjustedFlagMismatches.length}`,
        `status=${rowStatus}`,
      ].join(" "),
    );

    if (index < input.completed.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const mismatchedStocks =
    results.filter(
      (row) =>
        row.status !== "MATCH",
    );

  const emptyVendorWindows =
    results.filter(
      (row) =>
        row.vendorRows === 0,
    );

  /*
   * An empty event-centered vendor window is not itself a blocker:
   * the stock may have been suspended around the corporate action.
   * But any row returned by KIS must match canonical DB exactly.
   */
  const blockers =
    mismatchedStocks.map(
      (row) => ({
        stockCode: row.stockCode,
        status: row.status,
      }),
    );

  const status =
    blockers.length === 0
      ? "POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_COMPLETE"
      : "POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_BLOCKED";

  const report = {
    version: VERSION,
    status,

    source: {
      inputVersion: input.version,
      inputFingerprint: input.outputFingerprint ?? null,
    },

    policy: {
      adjustedPrice: true,
      kisMode: "FID_ORG_ADJ_PRC=0",
      probeBeforeDays: PROBE_BEFORE_DAYS,
      probeAfterDays: PROBE_AFTER_DAYS,
      snapshotEnd: SNAPSHOT_END,
      canonicalSource: "KIS_DAILY_V8_3",
      corporateActionFactorApplication: "NEVER",
      emptyVendorWindow:
        "WARNING_ONLY_SUSPENSION_MAY_EXPLAIN_NO_EVENT_CENTERED_ROWS",
    },

    counts: {
      stocks: results.length,
      matchedStocks:
        results.length - mismatchedStocks.length,
      mismatchedStocks: mismatchedStocks.length,
      emptyVendorWindows: emptyVendorWindows.length,
      totalVendorRows:
        results.reduce(
          (sum, row: any) => sum + row.vendorRows,
          0,
        ),
      totalCanonicalRows:
        results.reduce(
          (sum, row: any) => sum + row.canonicalRows,
          0,
        ),
      missingInDb:
        results.reduce(
          (sum, row: any) => sum + row.missingInDb.length,
          0,
        ),
      missingAtVendor:
        results.reduce(
          (sum, row: any) => sum + row.missingAtVendor.length,
          0,
        ),
      valueMismatches:
        results.reduce(
          (sum, row: any) => sum + row.valueMismatches.length,
          0,
        ),
      sourceMismatches:
        results.reduce(
          (sum, row: any) => sum + row.sourceMismatches.length,
          0,
        ),
      adjustedFlagMismatches:
        results.reduce(
          (sum, row: any) =>
            sum + row.adjustedFlagMismatches.length,
          0,
        ),
      kisRequests,
    },

    blockers,

    emptyVendorWindowStocks:
      emptyVendorWindows.map(
        (row) => row.stockCode,
      ),

    results,

    safety: {
      databaseReadsOnly: true,
      databaseWrites: 0,
      kisReadRequests: kisRequests,
      marketDailyBarsModified: 0,
      corporateActionFactorsAppliedToCanonicalBars: 0,
      coverageWindowAdvanced: false,
    },

    nextGate:
      status ===
      "POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_COMPLETE"
        ? "CLOSE_CURRENT_V9_8_CORPORATE_ACTION_REFRESH_CYCLE_AND_REVIEW_COVERAGE_ADVANCEMENT"
        : "STOP_AND_REVIEW",

    outputFile:
      path
        .relative(root, outputFile)
        .replaceAll("\\", "/"),
  };

  (report as any).outputFingerprint =
    sha256(
      JSON.stringify({
        version: report.version,
        inputFingerprint:
          report.source.inputFingerprint,
        status: report.status,
        results: results.map(
          (row: any) => [
            row.stockCode,
            row.probeStart,
            row.probeEnd,
            row.vendorRows,
            row.canonicalRows,
            row.status,
          ],
        ),
      }),
    );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: VERSION,
        ...report.counts,
        blockers: report.blockers,
        emptyVendorWindowStocks:
          report.emptyVendorWindowStocks,
        databaseWrites: 0,
        marketDailyBarsModified: 0,
        corporateActionFactorsAppliedToCanonicalBars: 0,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status !==
    "POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_COMPLETE"
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_FAILED",
        version: VERSION,
        error: String(error?.message ?? error),
        details: (error as any)?.details ?? null,
        databaseWrites: 0,
        marketDailyBarsModified: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
