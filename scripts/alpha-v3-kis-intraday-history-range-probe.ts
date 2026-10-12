import fs from "node:fs";
import path from "node:path";

import {
  getKisAccessToken,
} from "../lib/kis/client";

const REQUEST_DELAY_MS = 700;

function sleep(ms: number) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms),
  );
}

function digitsDate(sqlDate: string) {
  return sqlDate.replace(
    /-/g,
    "",
  );
}

async function fetchProbe(
  stockCode: string,
  targetDate: string,
  accessToken: string,
) {
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

  const params =
    new URLSearchParams({
      FID_COND_MRKT_DIV_CODE:
        "J",

      FID_INPUT_ISCD:
        stockCode,

      FID_INPUT_HOUR_1:
        "153000",

      FID_INPUT_DATE_1:
        digitsDate(
          targetDate,
        ),

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
      Record<string, any>;

  const rows =
    Array.isArray(
      body.output2,
    )
      ? body.output2
      : [];

  const requestedDate =
    digitsDate(
      targetDate,
    );

  const requestedRows =
    rows.filter(
      (row: any) =>
        String(
          row.stck_bsop_date ??
          "",
        ) ===
        requestedDate,
    );

  const times =
    requestedRows
      .map(
        (row: any) =>
          String(
            row.stck_cntg_hour ??
            "",
          ),
      )
      .filter(
        (value: string) =>
          /^\d{6}$/.test(
            value,
          ),
      )
      .sort();

  return {
    httpStatus:
      response.status,

    rtCd:
      body.rt_cd ??
      null,

    msgCd:
      body.msg_cd ??
      null,

    msg:
      body.msg1 ??
      null,

    totalOutputRows:
      rows.length,

    requestedDateRows:
      requestedRows.length,

    requestedDatePresent:
      requestedRows.length >
      0,

    earliestTime:
      times[0] ??
      null,

    latestTime:
      times.at(-1) ??
      null,

    returnedBusinessDates:
      [
        ...new Set(
          rows.map(
            (row: any) =>
              String(
                row.stck_bsop_date ??
                "",
              ),
          ),
        ),
      ].filter(Boolean),
  };
}

async function main() {
  const root =
    process.cwd();

  const inputPath =
    path.join(
      root,
      "logs",
      "alpha-v3-extended-pricevolume-top1-history.json",
    );

  if (
    !fs.existsSync(
      inputPath,
    )
  ) {
    throw new Error(
      "EXTENDED_TOP1_HISTORY_LOG_NOT_FOUND",
    );
  }

  const report =
    JSON.parse(
      fs.readFileSync(
        inputPath,
        "utf8",
      ),
    );

  const rows =
    report.top1Rows ??
    [];

  if (
    rows.length <
    100
  ) {
    throw new Error(
      `INSUFFICIENT_EXTENDED_ROWS:${rows.length}`,
    );
  }

  /*
   * Representative probes:
   * earliest, ~25%, ~50%, ~75%, latest.
   * Use the actual Top1 stock for that target session.
   */
  const indexes =
    [
      0,
      Math.floor(
        (rows.length - 1) *
        0.25,
      ),
      Math.floor(
        (rows.length - 1) *
        0.50,
      ),
      Math.floor(
        (rows.length - 1) *
        0.75,
      ),
      rows.length - 1,
    ];

  const targets =
    indexes.map(
      (index) => {
        const row =
          rows[index];

        return {
          index,

          sourceTradingDate:
            row.sourceTradingDate,

          targetSessionDate:
            row.targetSessionDate,

          stockCode:
            row.top1.stockCode,

          stockName:
            row.top1.stockName,
        };
      },
    );

  const accessToken =
    await getKisAccessToken();

  const probes =
    [];

  for (
    let index = 0;
    index < targets.length;
    index += 1
  ) {
    const target =
      targets[index];

    let probe;

    try {
      probe =
        await fetchProbe(
          target.stockCode,
          target.targetSessionDate,
          accessToken,
        );
    } catch (error) {
      probe = {
        error:
          String(
            error instanceof Error
              ? error.message
              : error,
          ),
      };
    }

    probes.push({
      ...target,
      probe,
    });

    if (
      index <
      targets.length - 1
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const available =
    probes.filter(
      (row: any) =>
        row.probe
          ?.requestedDatePresent ===
        true,
    );

  const result = {
    status:
      "ALPHA_V3_KIS_INTRADAY_HISTORY_RANGE_PROBE_COMPLETE",

    extendedTop1DateCount:
      rows.length,

    probeCount:
      probes.length,

    availableProbeCount:
      available.length,

    allRepresentativeDatesAvailable:
      available.length ===
      probes.length,

    probes,

    safety: {
      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionChanged:
        false,
    },

    nextGate:
      available.length ===
      probes.length
        ? "BUILD_EXTENDED_ENTRY_V3_KIS_MINUTE_REPLAY_BATCHER"
        : "DETERMINE_KIS_INTRADAY_RETENTION_BOUNDARY",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v3-kis-intraday-history-range-probe.json",
    ),
    JSON.stringify(
      result,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
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
            "ALPHA_V3_KIS_INTRADAY_HISTORY_RANGE_PROBE_FAILED",

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
