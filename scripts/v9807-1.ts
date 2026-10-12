/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  getDomesticDailyStockPrices,
  getKisAccessToken,
} from "../lib/kis/client";

const VERSION =
  "V9_8_7_1_KIS_REVERSE_SPLIT_BOUNDARY_PROBE";

const STOCK_CODE =
  "210120";

const PROVIDER_EVENT_ID =
  "20260424900689";

const EXPECTED_RATIO_FROM =
  5;

const EXPECTED_RATIO_TO =
  2;

const EXPECTED_PRICE_FACTOR =
  EXPECTED_RATIO_FROM /
  EXPECTED_RATIO_TO;

const FALLBACK_EFFECTIVE_DATE =
  "2026-06-12";

const START_DATE =
  "20260520";

const END_DATE =
  "20260831";

const REQUEST_DELAY_MS =
  1500;

function sleep(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
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

  const temp =
    `${file}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2,
    ),
    "utf8",
  );

  fs.renameSync(
    temp,
    file,
  );
}

function toNumber(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : null;
}

function compactToSqlDate(
  value: unknown,
) {
  const text =
    String(value ?? "")
      .trim();

  if (
    !/^\d{8}$/.test(
      text,
    )
  ) {
    return null;
  }

  return (
    `${text.slice(0, 4)}-` +
    `${text.slice(4, 6)}-` +
    `${text.slice(6, 8)}`
  );
}

function relativeError(
  actual: number,
  expected: number,
) {
  if (
    !Number.isFinite(actual) ||
    !Number.isFinite(expected) ||
    expected === 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    Math.abs(
      actual - expected,
    ) /
    Math.abs(expected)
  );
}

function normalizeRows(
  response: any,
  mode: "ADJUSTED_MODE0" | "ORIGINAL_MODE1",
) {
  if (
    String(
      response?.rt_cd ?? "",
    ) !== "0"
  ) {
    throw new Error(
      `${mode}_KIS_FAILED:` +
      String(
        response?.msg_cd ??
        response?.msg1 ??
        "UNKNOWN",
      ),
    );
  }

  const sourceRows =
    Array.isArray(
      response?.output2,
    )
      ? response.output2
      : [];

  const rows =
    sourceRows
      .map(
        (row: any) => {
          const tradingDate =
            compactToSqlDate(
              row?.stck_bsop_date,
            );

          const close =
            toNumber(
              row?.stck_clpr,
            );

          if (
            !tradingDate ||
            close === null ||
            close <= 0
          ) {
            return null;
          }

          return {
            tradingDate,
            close,
            modYn:
              row?.mod_yn ??
              null,
          };
        },
      )
      .filter(
        (
          row: {
            tradingDate: string;
            close: number;
            modYn: unknown;
          } | null,
        ): row is {
          tradingDate: string;
          close: number;
          modYn: unknown;
        } =>
          row !== null,
      )
      .sort(
        (a, b) =>
          a.tradingDate.localeCompare(
            b.tradingDate,
          ),
      );

  return rows;
}

async function main() {
  const root =
    path.resolve(
      process.cwd(),
    );

  const outputFile =
    path.join(
      root,
      "logs",
      "opendart-corporate-action-kis-boundary-probe-v9-8-7-1.json",
    );

  const token =
    await getKisAccessToken();

  const adjustedResponse =
    await getDomesticDailyStockPrices(
      {
        stockCode:
          STOCK_CODE,

        startDate:
          START_DATE,

        endDate:
          END_DATE,

        period:
          "D",

        adjustedPrice:
          true,
      },
      token,
    );

  await sleep(
    REQUEST_DELAY_MS,
  );

  const originalResponse =
    await getDomesticDailyStockPrices(
      {
        stockCode:
          STOCK_CODE,

        startDate:
          START_DATE,

        endDate:
          END_DATE,

        period:
          "D",

        adjustedPrice:
          false,
      },
      token,
    );

  const adjustedRows =
    normalizeRows(
      adjustedResponse,
      "ADJUSTED_MODE0",
    );

  const originalRows =
    normalizeRows(
      originalResponse,
      "ORIGINAL_MODE1",
    );

  const adjustedByDate =
    new Map(
      adjustedRows.map(
        (row) => [
          row.tradingDate,
          row,
        ],
      ),
    );

  const originalByDate =
    new Map(
      originalRows.map(
        (row) => [
          row.tradingDate,
          row,
        ],
      ),
    );

  const dates =
    [
      ...new Set([
        ...adjustedByDate.keys(),
        ...originalByDate.keys(),
      ]),
    ].sort();

  const joined =
    dates
      .map(
        (tradingDate) => {
          const adjusted =
            adjustedByDate.get(
              tradingDate,
            );

          const original =
            originalByDate.get(
              tradingDate,
            );

          if (
            !adjusted ||
            !original
          ) {
            return {
              tradingDate,

              adjustedClose:
                adjusted?.close ??
                null,

              originalClose:
                original?.close ??
                null,

              adjustedModYn:
                adjusted?.modYn ??
                null,

              originalModYn:
                original?.modYn ??
                null,

              adjustedToOriginalRatio:
                null,

              classification:
                "MODE_DATE_MISMATCH",
            };
          }

          const ratio =
            adjusted.close /
            original.close;

          const factorError =
            relativeError(
              ratio,
              EXPECTED_PRICE_FACTOR,
            );

          const unityError =
            relativeError(
              ratio,
              1,
            );

          let classification =
            "OTHER_RATIO";

          if (
            factorError <=
            0.01
          ) {
            classification =
              "EXPECTED_REVERSE_SPLIT_RATIO";
          } else if (
            unityError <=
            0.005
          ) {
            classification =
              "MODES_EQUAL";
          }

          return {
            tradingDate,

            adjustedClose:
              adjusted.close,

            originalClose:
              original.close,

            adjustedModYn:
              adjusted.modYn,

            originalModYn:
              original.modYn,

            adjustedToOriginalRatio:
              Number(
                ratio.toPrecision(
                  12,
                ),
              ),

            expectedPriceFactor:
              EXPECTED_PRICE_FACTOR,

            factorRelativeError:
              Number(
                factorError.toPrecision(
                  8,
                ),
              ),

            unityRelativeError:
              Number(
                unityError.toPrecision(
                  8,
                ),
              ),

            classification,
          };
        },
      );

  const commonRows =
    joined.filter(
      (row) =>
        row.adjustedClose !==
          null &&
        row.originalClose !==
          null,
    );

  const factorRows =
    commonRows.filter(
      (row) =>
        row.classification ===
        "EXPECTED_REVERSE_SPLIT_RATIO",
    );

  const equalRows =
    commonRows.filter(
      (row) =>
        row.classification ===
        "MODES_EQUAL",
    );

  const otherRows =
    commonRows.filter(
      (row) =>
        ![
          "EXPECTED_REVERSE_SPLIT_RATIO",
          "MODES_EQUAL",
        ].includes(
          row.classification,
        ),
    );

  const factorBeforeCandidate =
    factorRows.filter(
      (row) =>
        row.tradingDate <
        FALLBACK_EFFECTIVE_DATE,
    );

  const factorOnOrAfterCandidate =
    factorRows.filter(
      (row) =>
        row.tradingDate >=
        FALLBACK_EFFECTIVE_DATE,
    );

  const equalBeforeCandidate =
    equalRows.filter(
      (row) =>
        row.tradingDate <
        FALLBACK_EFFECTIVE_DATE,
    );

  const equalOnOrAfterCandidate =
    equalRows.filter(
      (row) =>
        row.tradingDate >=
        FALLBACK_EFFECTIVE_DATE,
    );

  const lastFactorBeforeCandidate =
    factorBeforeCandidate.at(
      -1,
    ) ??
    null;

  const firstEqualOnOrAfterCandidate =
    equalOnOrAfterCandidate[0] ??
    null;

  const lastTradingBeforeCandidate =
    commonRows
      .filter(
        (row) =>
          row.tradingDate <
          FALLBACK_EFFECTIVE_DATE,
      )
      .at(-1) ??
    null;

  const firstTradingOnOrAfterCandidate =
    commonRows.find(
      (row) =>
        row.tradingDate >=
        FALLBACK_EFFECTIVE_DATE,
    ) ??
    null;

  const factorEvidenceStrong =
    factorBeforeCandidate.length >=
    3;

  const noContradictoryFactorAfterCandidate =
    factorOnOrAfterCandidate.length ===
    0;

  const noPrematureUnityBeforeCandidate =
    equalBeforeCandidate.length ===
    0;

  const postCandidateUnityObserved =
    equalOnOrAfterCandidate.length >
    0;

  const boundaryConsistent =
    factorEvidenceStrong &&
    noContradictoryFactorAfterCandidate &&
    noPrematureUnityBeforeCandidate &&
    postCandidateUnityObserved &&
    lastFactorBeforeCandidate !==
      null &&
    firstEqualOnOrAfterCandidate !==
      null &&
    lastFactorBeforeCandidate
      .tradingDate <
      FALLBACK_EFFECTIVE_DATE &&
    firstEqualOnOrAfterCandidate
      .tradingDate >=
      FALLBACK_EFFECTIVE_DATE;

  const exactMarketDateProven =
    boundaryConsistent &&
    firstTradingOnOrAfterCandidate
      ?.tradingDate ===
      FALLBACK_EFFECTIVE_DATE &&
    firstEqualOnOrAfterCandidate
      ?.tradingDate ===
      FALLBACK_EFFECTIVE_DATE;

  const status =
    exactMarketDateProven
      ? "KIS_BOUNDARY_EXACTLY_CONFIRMS_FALLBACK_EFFECTIVE_DATE"
      : boundaryConsistent
        ? "KIS_BOUNDARY_CORROBORATES_FALLBACK_DATE_NOT_EXACT"
        : "KIS_BOUNDARY_INCONCLUSIVE";

  const report = {
    status,
    version:
      VERSION,

    target: {
      stockCode:
        STOCK_CODE,

      providerEventId:
        PROVIDER_EVENT_ID,

      actionType:
        "REVERSE_SPLIT",

      ratioFrom:
        EXPECTED_RATIO_FROM,

      ratioTo:
        EXPECTED_RATIO_TO,

      expectedPriceFactor:
        EXPECTED_PRICE_FACTOR,

      fallbackEffectiveDateCandidate:
        FALLBACK_EFFECTIVE_DATE,
    },

    request: {
      startDate:
        START_DATE,

      endDate:
        END_DATE,

      period:
        "D",

      adjustedMode:
        {
          adjustedPrice:
            true,
          fidOrgAdjPrc:
            "0",
        },

      originalMode:
        {
          adjustedPrice:
            false,
          fidOrgAdjPrc:
            "1",
        },

      requestDelayMs:
        REQUEST_DELAY_MS,
    },

    counts: {
      adjustedRows:
        adjustedRows.length,

      originalRows:
        originalRows.length,

      commonRows:
        commonRows.length,

      expectedFactorRows:
        factorRows.length,

      equalModeRows:
        equalRows.length,

      otherRatioRows:
        otherRows.length,

      factorRowsBeforeCandidate:
        factorBeforeCandidate.length,

      factorRowsOnOrAfterCandidate:
        factorOnOrAfterCandidate.length,

      equalRowsBeforeCandidate:
        equalBeforeCandidate.length,

      equalRowsOnOrAfterCandidate:
        equalOnOrAfterCandidate.length,
    },

    boundary: {
      lastFactorBeforeCandidate,
      firstEqualOnOrAfterCandidate,
      lastTradingBeforeCandidate,
      firstTradingOnOrAfterCandidate,

      factorEvidenceStrong,
      noContradictoryFactorAfterCandidate,
      noPrematureUnityBeforeCandidate,
      postCandidateUnityObserved,
      boundaryConsistent,
      exactMarketDateProven,
    },

    interpretation: {
      ratioMeaning:
        "KIS mode0 adjusted close / mode1 original close",

      expectedPreActionRatio:
        EXPECTED_PRICE_FACTOR,

      expectedPostActionRatio:
        1,

      fallbackDatePromotionAllowed:
        exactMarketDateProven,

      ifBoundaryOnly:
        "Do not promote the date from KIS alone when trading suspension creates a gap; combine with DART/KRX event evidence.",
    },

    evidenceRows:
      joined,

    safety: {
      networkRequests:
        2,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      providerEventIdsPersisted:
        0,

      effectiveDatePersisted:
        false,

      factorsPersisted:
        false,

      coverageWindowAdvanced:
        false,
    },

    outputFile:
      "logs/opendart-corporate-action-kis-boundary-probe-v9-8-7-1.json",
  };

  (report as any).outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          VERSION,

        target:
          report.target,

        status:
          report.status,

        boundary:
          report.boundary,

        rows:
          joined.map(
            (row) => [
              row.tradingDate,
              row.adjustedClose,
              row.originalClose,
              row.adjustedToOriginalRatio,
              row.classification,
            ],
          ),
      }),
    );

  atomicSaveJson(
    outputFile,
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          VERSION,

        target:
          report.target,

        counts:
          report.counts,

        boundary:
          report.boundary,

        networkRequests:
          2,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        effectiveDatePersisted:
          false,

        coverageWindowAdvanced:
          false,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      String(
        error instanceof Error
          ? error.message
          : error,
      ),
    );

    process.exitCode =
      1;
  },
);
