import fs from "node:fs";
import path from "node:path";

import {
  getKisAccessToken,
} from "../lib/kis/client";

function toText(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value);
}

async function main() {
  const root =
    process.cwd();

  const coveragePath =
    path.join(
      root,
      "logs",
      "alpha-v2-entry-target-session-coverage.json",
    );

  if (
    !fs.existsSync(
      coveragePath,
    )
  ) {
    throw new Error(
      "TARGET_SESSION_COVERAGE_LOG_NOT_FOUND",
    );
  }

  const coverage =
    JSON.parse(
      fs.readFileSync(
        coveragePath,
        "utf8",
      ),
    );

  const target =
    (
      coverage.missingRows ??
      []
    ).find(
      (row: any) =>
        row.targetSessionDate &&
        row.stockCode,
    );

  if (!target) {
    throw new Error(
      "NO_MISSING_TARGET_SESSION_FOUND",
    );
  }

  const appKey =
    process.env.KIS_APP_KEY;

  const appSecret =
    process.env.KIS_APP_SECRET;

  const baseUrl =
    process.env.KIS_BASE_URL ??
    "https://openapi.koreainvestment.com:9443";

  if (
    !appKey ||
    !appSecret
  ) {
    throw new Error(
      "KIS_APP_KEY_OR_SECRET_MISSING",
    );
  }

  const stockCode =
    String(
      target.stockCode,
    );

  const inputDate =
    String(
      target.targetSessionDate,
    ).replace(
      /-/g,
      "",
    );

  const inputHour =
    "153000";

  const accessToken =
    await getKisAccessToken();

  const params =
    new URLSearchParams({
      FID_COND_MRKT_DIV_CODE:
        "J",

      FID_INPUT_ISCD:
        stockCode,

      FID_INPUT_HOUR_1:
        inputHour,

      FID_INPUT_DATE_1:
        inputDate,

      FID_PW_DATA_INCU_YN:
        "Y",

      FID_FAKE_TICK_INCU_YN:
        "",
    });

  const response =
    await fetch(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?${params}`,
      {
        method:
          "GET",

        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          authorization:
            `Bearer ${accessToken}`,

          appkey:
            appKey,

          appsecret:
            appSecret,

          tr_id:
            "FHKST03010230",

          custtype:
            "P",
        },

        cache:
          "no-store",
      },
    );

  const body =
    await response.json() as
      Record<
        string,
        any
      >;

  const output2 =
    Array.isArray(
      body.output2,
    )
      ? body.output2
      : [];

  const rows =
    output2.map(
      (row: any) => ({
        businessDate:
          toText(
            row.stck_bsop_date,
          ),

        time:
          toText(
            row.stck_cntg_hour,
          ),

        currentPrice:
          toText(
            row.stck_prpr,
          ),

        open:
          toText(
            row.stck_oprc,
          ),

        high:
          toText(
            row.stck_hgpr,
          ),

        low:
          toText(
            row.stck_lwpr,
          ),

        intervalVolume:
          toText(
            row.cntg_vol,
          ),

        accumulatedVolume:
          toText(
            row.acml_vol,
          ),

        accumulatedTradingValue:
          toText(
            row.acml_tr_pbmn,
          ),

        raw:
          row,
      }),
    );

  const times =
    rows
      .map(
        (row: any) =>
          row.time,
      )
      .filter(
        (
          value: any,
        ): value is string =>
          typeof value ===
            "string" &&
          /^\d{6}$/.test(
            value,
          ),
      )
      .sort();

  const businessDates =
    [
      ...new Set(
        rows
          .map(
            (row: any) =>
              row.businessDate,
          )
          .filter(
            Boolean,
          ),
      ),
    ];

  const report = {
    status:
      response.ok &&
      (
        body.rt_cd ===
          undefined ||
        body.rt_cd ===
          "0"
      )
        ? "ALPHA_V2_KIS_HISTORICAL_INTRADAY_PROBE_COMPLETE"
        : "ALPHA_V2_KIS_HISTORICAL_INTRADAY_PROBE_API_ERROR",

    target: {
      alphaDate:
        target.alphaDate ??
        null,

      stockCode,

      targetSessionDate:
        target.targetSessionDate,

      requestedDate:
        inputDate,

      requestedHour:
        inputHour,
    },

    endpoint: {
      path:
        "/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice",

      trId:
        "FHKST03010230",

      pastDataIncluded:
        true,
    },

    response: {
      httpStatus:
        response.status,

      rtCd:
        body.rt_cd ??
        null,

      msgCd:
        body.msg_cd ??
        null,

      msg1:
        body.msg1 ??
        null,

      rowCount:
        rows.length,

      businessDates,

      earliestTime:
        times[0] ??
        null,

      latestTime:
        times.at(-1) ??
        null,

      output1Keys:
        body.output1 &&
        typeof body.output1 ===
          "object"
          ? Object.keys(
              body.output1,
            )
          : [],

      output2Keys:
        output2[0] &&
        typeof output2[0] ===
          "object"
          ? Object.keys(
              output2[0],
            )
          : [],
    },

    sample: {
      earliestRows:
        [...rows]
          .sort(
            (
              a: any,
              b: any,
            ) =>
              String(
                a.time,
              ).localeCompare(
                String(
                  b.time,
                ),
              ),
          )
          .slice(
            0,
            3,
          ),

      latestRows:
        [...rows]
          .sort(
            (
              a: any,
              b: any,
            ) =>
              String(
                b.time,
              ).localeCompare(
                String(
                  a.time,
                ),
              ),
          )
          .slice(
            0,
            3,
          ),
    },

    validation: {
      requestedDatePresent:
        businessDates.includes(
          inputDate,
        ),

      hasMinuteTime:
        times.length >
        0,

      hasIntervalVolume:
        output2.some(
          (row: any) =>
            row.cntg_vol !==
              undefined &&
            row.cntg_vol !==
              null,
        ),

      hasAccumulatedVolume:
        output2.some(
          (row: any) =>
            row.acml_vol !==
              undefined &&
            row.acml_vol !==
              null,
        ),
    },

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      kisRequests:
        1,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionChanged:
        false,
    },

    nextGate:
      response.ok &&
      rows.length >
        0 &&
      businessDates.includes(
        inputDate,
      )
        ? "BUILD_CONTROLLED_INTRADAY_BACKFILL_PLAN"
        : "REVIEW_KIS_INTRADAY_RESPONSE_BEFORE_BACKFILL",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-kis-historical-intraday-probe.json",
    ),
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
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V2_KIS_HISTORICAL_INTRADAY_PROBE_FAILED",

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
