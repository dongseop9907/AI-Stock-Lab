import {
  getDomesticInvestorTradeDaily,
  getKisAccessToken,
} from "../lib/kis/client";

const VERSION =
  "ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE";

const TARGET_STOCK =
  "005930";

const TARGET_DATE =
  "20260730";

function asText(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(
    value,
  );
}

function rowDate(
  row:
    Record<string, unknown>,
) {
  return asText(
    row.stck_bsop_date,
  );
}

function selectSample(
  row:
    Record<string, unknown>,
) {
  return {
    stck_bsop_date:
      asText(
        row.stck_bsop_date,
      ),

    stck_clpr:
      asText(
        row.stck_clpr,
      ),

    prsn_ntby_qty:
      asText(
        row.prsn_ntby_qty,
      ),

    frgn_ntby_qty:
      asText(
        row.frgn_ntby_qty,
      ),

    orgn_ntby_qty:
      asText(
        row.orgn_ntby_qty,
      ),

    prsn_ntby_tr_pbmn:
      asText(
        row.prsn_ntby_tr_pbmn,
      ),

    frgn_ntby_tr_pbmn:
      asText(
        row.frgn_ntby_tr_pbmn,
      ),

    orgn_ntby_tr_pbmn:
      asText(
        row.orgn_ntby_tr_pbmn,
      ),
  };
}

async function main() {
  const accessToken =
    await getKisAccessToken();

  const result =
    await getDomesticInvestorTradeDaily(
      TARGET_STOCK,
      TARGET_DATE,
      accessToken,
    );

  const body =
    result.body;

  const output1 =
    Array.isArray(
      body.output1,
    )
      ? body.output1
      : body.output1
      ? [
          body.output1,
        ]
      : [];

  const output2 =
    Array.isArray(
      body.output2,
    )
      ? body.output2
      : body.output2
      ? [
          body.output2,
        ]
      : [];

  const rows =
    output2 as
      Record<
        string,
        unknown
      >[];

  const dates =
    rows
      .map(
        rowDate,
      )
      .filter(
        (
          value,
        ): value is string =>
          Boolean(value),
      )
      .sort();

  const requestedDatePresent =
    dates.includes(
      TARGET_DATE,
    );

  const historicalRowsAtOrBeforeTarget =
    dates.filter(
      (
        date,
      ) =>
        date <=
        TARGET_DATE,
    );

  const report = {
    status:
      "ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE_COMPLETE",

    version:
      VERSION,

    endpoint: {
      path:
        "/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily",

      trId:
        "FHPTJ04160001",

      stockCode:
        TARGET_STOCK,

      inputDate:
        TARGET_DATE,

      marketDivision:
        "J",
    },

    response: {
      rtCd:
        body.rt_cd ??
        null,

      msgCd:
        body.msg_cd ??
        null,

      msg:
        body.msg1 ??
        null,

      trCont:
        result.trCont,

      output1Rows:
        output1.length,

      output2Rows:
        rows.length,

      output2FieldNames:
        rows[0]
          ? Object.keys(
              rows[0],
            ).sort()
          : [],
    },

    historicalCoverage: {
      earliestReturnedDate:
        dates[0] ??
        null,

      latestReturnedDate:
        dates.at(-1) ??
        null,

      requestedDatePresent,

      rowsAtOrBeforeRequestedDate:
        historicalRowsAtOrBeforeTarget
          .length,

      canReachRequestedHistoricalDate:
        requestedDatePresent ||
        historicalRowsAtOrBeforeTarget
          .length >
          0,
    },

    samples:
      rows
        .slice(
          0,
          5,
        )
        .map(
          selectSample,
        ),

    decision: {
      historicalFlowBackfillFeasible:
        (
          requestedDatePresent ||
          historicalRowsAtOrBeforeTarget
            .length >
            0
        ),

      continuationAvailable:
        Boolean(
          result.trCont,
        ),

      nextGate:
        (
          requestedDatePresent ||
          historicalRowsAtOrBeforeTarget
            .length >
            0
        )
          ? "ALPHA_V1_DESIGN_KIS_HISTORICAL_FLOW_BACKFILL"
          : "ALPHA_V1_REVIEW_HISTORICAL_FLOW_ALTERNATIVE_SOURCE",
    },

    safety: {
      databaseWrites:
        0,

      networkRequests:
        2,

      tokenRequests:
        1,

      kisHistoricalFlowRequests:
        1,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

main().catch(
  (
    error,
  ) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          databaseWrites:
            0,

          ordersCreated:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
