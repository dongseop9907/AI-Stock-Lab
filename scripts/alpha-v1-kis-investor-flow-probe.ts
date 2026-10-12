import fs from "node:fs";
import path from "node:path";

import {
  getDomesticInvestorTrend,
  getKisAccessToken,
  type KisDomesticInvestorTrendOutput,
} from "../lib/kis/client";

const VERSION =
  "ALPHA_V1_KIS_INVESTOR_FLOW_PROBE";

const STOCKS = [
  "000660",
  "005380",
  "005930",
  "035420",
  "035720",
];

const REQUEST_DELAY_MS =
  700;

function sleep(
  milliseconds: number,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function pickRow(
  row: KisDomesticInvestorTrendOutput,
) {
  return {
    date:
      row.stck_bsop_date ??
      null,

    close:
      toNumber(
        row.stck_clpr,
      ),

    volume:
      toNumber(
        row.acml_vol,
      ),

    turnover:
      toNumber(
        row.acml_tr_pbmn,
      ),

    foreignNetBuyQty:
      toNumber(
        row.frgn_ntby_qty,
      ),

    institutionNetBuyQty:
      toNumber(
        row.orgn_ntby_qty,
      ),

    individualNetBuyQty:
      toNumber(
        row.prsn_ntby_qty,
      ),
  };
}

async function main() {
  const accessToken =
    await getKisAccessToken();

  const results:
    Array<Record<string, unknown>> =
    [];

  let successfulRequests =
    0;

  let failedRequests =
    0;

  for (
    let index = 0;
    index < STOCKS.length;
    index += 1
  ) {
    const stockCode =
      STOCKS[index];

    try {
      const response =
        await getDomesticInvestorTrend(
          stockCode,
          accessToken,
        );

      successfulRequests += 1;

      const rows =
        Array.isArray(
          response.output,
        )
          ? response.output
          : [];

      const fieldNames =
        [
          ...new Set(
            rows
              .slice(0, 5)
              .flatMap(
                (row) =>
                  Object.keys(row),
              ),
          ),
        ].sort();

      const compactRows =
        rows
          .slice(0, 10)
          .map(
            pickRow,
          );

      const usableFlowRows =
        compactRows.filter(
          (row) =>
            row.foreignNetBuyQty !==
              null ||
            row.institutionNetBuyQty !==
              null,
        );

      results.push({
        stockCode,

        status:
          "OK",

        rtCd:
          response.rt_cd ??
          null,

        msgCd:
          response.msg_cd ??
          null,

        msg:
          response.msg1 ??
          null,

        rowCount:
          rows.length,

        fieldNames,

        latestRows:
          compactRows,

        usableFlowRows:
          usableFlowRows.length,

        latestDate:
          compactRows[0]
            ?.date ??
          null,
      });
    } catch (error) {
      failedRequests += 1;

      results.push({
        stockCode,

        status:
          "FAILED",

        error:
          String(
            error instanceof Error
              ? error.message
              : error,
          ),
      });
    }

    if (
      index <
      STOCKS.length - 1
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const successful =
    results.filter(
      (row) =>
        row.status ===
        "OK",
    );

  const usableStocks =
    successful.filter(
      (row) =>
        Number(
          row.usableFlowRows ??
          0,
        ) > 0,
    );

  const report = {
    status:
      failedRequests === 0 &&
      usableStocks.length ===
        STOCKS.length
        ? "ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_COMPLETE"
        : "ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_COMPLETE_WITH_GAPS",

    version:
      VERSION,

    endpoint: {
      path:
        "/uapi/domestic-stock/v1/quotations/inquire-investor",

      trId:
        "FHKST01010900",

      marketDivision:
        "J",
    },

    requestedStocks:
      STOCKS,

    counts: {
      requested:
        STOCKS.length,

      successfulRequests,

      failedRequests,

      stocksWithUsableFlow:
        usableStocks.length,
    },

    results,

    interpretation: {
      canBindFlowFeature:
        usableStocks.length ===
        STOCKS.length,

      expectedCoreFields: [
        "stck_bsop_date",
        "acml_vol",
        "frgn_ntby_qty",
        "orgn_ntby_qty",
        "prsn_ntby_qty",
      ],

      nextIfUsable:
        "BUILD_ALPHA_V1_KIS_FLOW_EVIDENCE_ADAPTER",

      nextIfGap:
        "REVIEW_KIS_PAYLOAD_OR_PERMISSION_WITHOUT_FABRICATING_FLOW",
    },

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      kisInvestorRequests:
        STOCKS.length,

      tokenRequest:
        "GET_KIS_ACCESS_TOKEN_MAY_ISSUE_ONE_TOKEN_REQUEST",

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },

    outputFile:
      "logs/alpha-v1-kis-investor-flow-probe.json",
  };

  const outputFile =
    path.resolve(
      process.cwd(),
      report.outputFile,
    );

  fs.mkdirSync(
    path.dirname(
      outputFile,
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  if (
    successfulRequests === 0
  ) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          safety: {
            databaseWrites:
              0,

            ordersCreated:
              0,

            productionDecisionApplied:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
  },
);
