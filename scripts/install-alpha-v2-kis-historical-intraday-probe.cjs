#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root =
  path.resolve(
    __dirname,
    '..',
  );

fs.writeFileSync(
  path.join(
    root,
    'scripts',
    'alpha-v2-kis-historical-intraday-probe.ts',
  ),
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  getKisAccessToken,\n} from \"../lib/kis/client\";\n\nfunction toText(\n  value: unknown,\n): string | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  return String(value);\n}\n\nasync function main() {\n  const root =\n    process.cwd();\n\n  const coveragePath =\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v2-entry-target-session-coverage.json\",\n    );\n\n  if (\n    !fs.existsSync(\n      coveragePath,\n    )\n  ) {\n    throw new Error(\n      \"TARGET_SESSION_COVERAGE_LOG_NOT_FOUND\",\n    );\n  }\n\n  const coverage =\n    JSON.parse(\n      fs.readFileSync(\n        coveragePath,\n        \"utf8\",\n      ),\n    );\n\n  const target =\n    (\n      coverage.missingRows ??\n      []\n    ).find(\n      (row: any) =>\n        row.targetSessionDate &&\n        row.stockCode,\n    );\n\n  if (!target) {\n    throw new Error(\n      \"NO_MISSING_TARGET_SESSION_FOUND\",\n    );\n  }\n\n  const appKey =\n    process.env.KIS_APP_KEY;\n\n  const appSecret =\n    process.env.KIS_APP_SECRET;\n\n  const baseUrl =\n    process.env.KIS_BASE_URL ??\n    \"https://openapi.koreainvestment.com:9443\";\n\n  if (\n    !appKey ||\n    !appSecret\n  ) {\n    throw new Error(\n      \"KIS_APP_KEY_OR_SECRET_MISSING\",\n    );\n  }\n\n  const stockCode =\n    String(\n      target.stockCode,\n    );\n\n  const inputDate =\n    String(\n      target.targetSessionDate,\n    ).replace(\n      /-/g,\n      \"\",\n    );\n\n  const inputHour =\n    \"153000\";\n\n  const accessToken =\n    await getKisAccessToken();\n\n  const params =\n    new URLSearchParams({\n      FID_COND_MRKT_DIV_CODE:\n        \"J\",\n\n      FID_INPUT_ISCD:\n        stockCode,\n\n      FID_INPUT_HOUR_1:\n        inputHour,\n\n      FID_INPUT_DATE_1:\n        inputDate,\n\n      FID_PW_DATA_INCU_YN:\n        \"Y\",\n\n      FID_FAKE_TICK_INCU_YN:\n        \"\",\n    });\n\n  const response =\n    await fetch(\n      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?${params}`,\n      {\n        method:\n          \"GET\",\n\n        headers: {\n          \"Content-Type\":\n            \"application/json; charset=utf-8\",\n\n          authorization:\n            `Bearer ${accessToken}`,\n\n          appkey:\n            appKey,\n\n          appsecret:\n            appSecret,\n\n          tr_id:\n            \"FHKST03010230\",\n\n          custtype:\n            \"P\",\n        },\n\n        cache:\n          \"no-store\",\n      },\n    );\n\n  const body =\n    await response.json() as\n      Record<\n        string,\n        any\n      >;\n\n  const output2 =\n    Array.isArray(\n      body.output2,\n    )\n      ? body.output2\n      : [];\n\n  const rows =\n    output2.map(\n      (row: any) => ({\n        businessDate:\n          toText(\n            row.stck_bsop_date,\n          ),\n\n        time:\n          toText(\n            row.stck_cntg_hour,\n          ),\n\n        currentPrice:\n          toText(\n            row.stck_prpr,\n          ),\n\n        open:\n          toText(\n            row.stck_oprc,\n          ),\n\n        high:\n          toText(\n            row.stck_hgpr,\n          ),\n\n        low:\n          toText(\n            row.stck_lwpr,\n          ),\n\n        intervalVolume:\n          toText(\n            row.cntg_vol,\n          ),\n\n        accumulatedVolume:\n          toText(\n            row.acml_vol,\n          ),\n\n        accumulatedTradingValue:\n          toText(\n            row.acml_tr_pbmn,\n          ),\n\n        raw:\n          row,\n      }),\n    );\n\n  const times =\n    rows\n      .map(\n        (row: any) =>\n          row.time,\n      )\n      .filter(\n        (\n          value: any,\n        ): value is string =>\n          typeof value ===\n            \"string\" &&\n          /^\\d{6}$/.test(\n            value,\n          ),\n      )\n      .sort();\n\n  const businessDates =\n    [\n      ...new Set(\n        rows\n          .map(\n            (row: any) =>\n              row.businessDate,\n          )\n          .filter(\n            Boolean,\n          ),\n      ),\n    ];\n\n  const report = {\n    status:\n      response.ok &&\n      (\n        body.rt_cd ===\n          undefined ||\n        body.rt_cd ===\n          \"0\"\n      )\n        ? \"ALPHA_V2_KIS_HISTORICAL_INTRADAY_PROBE_COMPLETE\"\n        : \"ALPHA_V2_KIS_HISTORICAL_INTRADAY_PROBE_API_ERROR\",\n\n    target: {\n      alphaDate:\n        target.alphaDate ??\n        null,\n\n      stockCode,\n\n      targetSessionDate:\n        target.targetSessionDate,\n\n      requestedDate:\n        inputDate,\n\n      requestedHour:\n        inputHour,\n    },\n\n    endpoint: {\n      path:\n        \"/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice\",\n\n      trId:\n        \"FHKST03010230\",\n\n      pastDataIncluded:\n        true,\n    },\n\n    response: {\n      httpStatus:\n        response.status,\n\n      rtCd:\n        body.rt_cd ??\n        null,\n\n      msgCd:\n        body.msg_cd ??\n        null,\n\n      msg1:\n        body.msg1 ??\n        null,\n\n      rowCount:\n        rows.length,\n\n      businessDates,\n\n      earliestTime:\n        times[0] ??\n        null,\n\n      latestTime:\n        times.at(-1) ??\n        null,\n\n      output1Keys:\n        body.output1 &&\n        typeof body.output1 ===\n          \"object\"\n          ? Object.keys(\n              body.output1,\n            )\n          : [],\n\n      output2Keys:\n        output2[0] &&\n        typeof output2[0] ===\n          \"object\"\n          ? Object.keys(\n              output2[0],\n            )\n          : [],\n    },\n\n    sample: {\n      earliestRows:\n        [...rows]\n          .sort(\n            (\n              a: any,\n              b: any,\n            ) =>\n              String(\n                a.time,\n              ).localeCompare(\n                String(\n                  b.time,\n                ),\n              ),\n          )\n          .slice(\n            0,\n            3,\n          ),\n\n      latestRows:\n        [...rows]\n          .sort(\n            (\n              a: any,\n              b: any,\n            ) =>\n              String(\n                b.time,\n              ).localeCompare(\n                String(\n                  a.time,\n                ),\n              ),\n          )\n          .slice(\n            0,\n            3,\n          ),\n    },\n\n    validation: {\n      requestedDatePresent:\n        businessDates.includes(\n          inputDate,\n        ),\n\n      hasMinuteTime:\n        times.length >\n        0,\n\n      hasIntervalVolume:\n        output2.some(\n          (row: any) =>\n            row.cntg_vol !==\n              undefined &&\n            row.cntg_vol !==\n              null,\n        ),\n\n      hasAccumulatedVolume:\n        output2.some(\n          (row: any) =>\n            row.acml_vol !==\n              undefined &&\n            row.acml_vol !==\n              null,\n        ),\n    },\n\n    safety: {\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      kisRequests:\n        1,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionChanged:\n        false,\n    },\n\n    nextGate:\n      response.ok &&\n      rows.length >\n        0 &&\n      businessDates.includes(\n        inputDate,\n      )\n        ? \"BUILD_CONTROLLED_INTRADAY_BACKFILL_PLAN\"\n        : \"REVIEW_KIS_INTRADAY_RESPONSE_BEFORE_BACKFILL\",\n  };\n\n  fs.writeFileSync(\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v2-kis-historical-intraday-probe.json\",\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V2_KIS_HISTORICAL_INTRADAY_PROBE_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n",
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V2_KIS_HISTORICAL_INTRADAY_PROBE_INSTALLED',

      generatedFile:
        'scripts/alpha-v2-kis-historical-intraday-probe.ts',

      productionChanged:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      nextAction:
        'RUN_KIS_HISTORICAL_INTRADAY_PROBE'
    },
    null,
    2,
  ),
);
