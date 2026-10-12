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
    'alpha-v3-kis-intraday-history-range-probe.ts',
  ),
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  getKisAccessToken,\n} from \"../lib/kis/client\";\n\nconst REQUEST_DELAY_MS = 700;\n\nfunction sleep(ms: number) {\n  return new Promise(\n    (resolve) =>\n      setTimeout(resolve, ms),\n  );\n}\n\nfunction digitsDate(sqlDate: string) {\n  return sqlDate.replace(\n    /-/g,\n    \"\",\n  );\n}\n\nasync function fetchProbe(\n  stockCode: string,\n  targetDate: string,\n  accessToken: string,\n) {\n  const appKey =\n    process.env.KIS_APP_KEY;\n\n  const appSecret =\n    process.env.KIS_APP_SECRET;\n\n  const baseUrl =\n    process.env.KIS_BASE_URL ??\n    \"https://openapi.koreainvestment.com:9443\";\n\n  if (\n    !appKey ||\n    !appSecret\n  ) {\n    throw new Error(\n      \"KIS_APP_KEY_OR_SECRET_MISSING\",\n    );\n  }\n\n  const params =\n    new URLSearchParams({\n      FID_COND_MRKT_DIV_CODE:\n        \"J\",\n\n      FID_INPUT_ISCD:\n        stockCode,\n\n      FID_INPUT_HOUR_1:\n        \"153000\",\n\n      FID_INPUT_DATE_1:\n        digitsDate(\n          targetDate,\n        ),\n\n      FID_PW_DATA_INCU_YN:\n        \"Y\",\n\n      FID_FAKE_TICK_INCU_YN:\n        \"\",\n    });\n\n  const response =\n    await fetch(\n      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?${params}`,\n      {\n        method:\n          \"GET\",\n\n        headers: {\n          \"Content-Type\":\n            \"application/json; charset=utf-8\",\n\n          authorization:\n            `Bearer ${accessToken}`,\n\n          appkey:\n            appKey,\n\n          appsecret:\n            appSecret,\n\n          tr_id:\n            \"FHKST03010230\",\n\n          custtype:\n            \"P\",\n        },\n\n        cache:\n          \"no-store\",\n      },\n    );\n\n  const body =\n    await response.json() as\n      Record<string, any>;\n\n  const rows =\n    Array.isArray(\n      body.output2,\n    )\n      ? body.output2\n      : [];\n\n  const requestedDate =\n    digitsDate(\n      targetDate,\n    );\n\n  const requestedRows =\n    rows.filter(\n      (row: any) =>\n        String(\n          row.stck_bsop_date ??\n          \"\",\n        ) ===\n        requestedDate,\n    );\n\n  const times =\n    requestedRows\n      .map(\n        (row: any) =>\n          String(\n            row.stck_cntg_hour ??\n            \"\",\n          ),\n      )\n      .filter(\n        (value: string) =>\n          /^\\d{6}$/.test(\n            value,\n          ),\n      )\n      .sort();\n\n  return {\n    httpStatus:\n      response.status,\n\n    rtCd:\n      body.rt_cd ??\n      null,\n\n    msgCd:\n      body.msg_cd ??\n      null,\n\n    msg:\n      body.msg1 ??\n      null,\n\n    totalOutputRows:\n      rows.length,\n\n    requestedDateRows:\n      requestedRows.length,\n\n    requestedDatePresent:\n      requestedRows.length >\n      0,\n\n    earliestTime:\n      times[0] ??\n      null,\n\n    latestTime:\n      times.at(-1) ??\n      null,\n\n    returnedBusinessDates:\n      [\n        ...new Set(\n          rows.map(\n            (row: any) =>\n              String(\n                row.stck_bsop_date ??\n                \"\",\n              ),\n          ),\n        ),\n      ].filter(Boolean),\n  };\n}\n\nasync function main() {\n  const root =\n    process.cwd();\n\n  const inputPath =\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v3-extended-pricevolume-top1-history.json\",\n    );\n\n  if (\n    !fs.existsSync(\n      inputPath,\n    )\n  ) {\n    throw new Error(\n      \"EXTENDED_TOP1_HISTORY_LOG_NOT_FOUND\",\n    );\n  }\n\n  const report =\n    JSON.parse(\n      fs.readFileSync(\n        inputPath,\n        \"utf8\",\n      ),\n    );\n\n  const rows =\n    report.top1Rows ??\n    [];\n\n  if (\n    rows.length <\n    100\n  ) {\n    throw new Error(\n      `INSUFFICIENT_EXTENDED_ROWS:${rows.length}`,\n    );\n  }\n\n  /*\n   * Representative probes:\n   * earliest, ~25%, ~50%, ~75%, latest.\n   * Use the actual Top1 stock for that target session.\n   */\n  const indexes =\n    [\n      0,\n      Math.floor(\n        (rows.length - 1) *\n        0.25,\n      ),\n      Math.floor(\n        (rows.length - 1) *\n        0.50,\n      ),\n      Math.floor(\n        (rows.length - 1) *\n        0.75,\n      ),\n      rows.length - 1,\n    ];\n\n  const targets =\n    indexes.map(\n      (index) => {\n        const row =\n          rows[index];\n\n        return {\n          index,\n\n          sourceTradingDate:\n            row.sourceTradingDate,\n\n          targetSessionDate:\n            row.targetSessionDate,\n\n          stockCode:\n            row.top1.stockCode,\n\n          stockName:\n            row.top1.stockName,\n        };\n      },\n    );\n\n  const accessToken =\n    await getKisAccessToken();\n\n  const probes =\n    [];\n\n  for (\n    let index = 0;\n    index < targets.length;\n    index += 1\n  ) {\n    const target =\n      targets[index];\n\n    let probe;\n\n    try {\n      probe =\n        await fetchProbe(\n          target.stockCode,\n          target.targetSessionDate,\n          accessToken,\n        );\n    } catch (error) {\n      probe = {\n        error:\n          String(\n            error instanceof Error\n              ? error.message\n              : error,\n          ),\n      };\n    }\n\n    probes.push({\n      ...target,\n      probe,\n    });\n\n    if (\n      index <\n      targets.length - 1\n    ) {\n      await sleep(\n        REQUEST_DELAY_MS,\n      );\n    }\n  }\n\n  const available =\n    probes.filter(\n      (row: any) =>\n        row.probe\n          ?.requestedDatePresent ===\n        true,\n    );\n\n  const result = {\n    status:\n      \"ALPHA_V3_KIS_INTRADAY_HISTORY_RANGE_PROBE_COMPLETE\",\n\n    extendedTop1DateCount:\n      rows.length,\n\n    probeCount:\n      probes.length,\n\n    availableProbeCount:\n      available.length,\n\n    allRepresentativeDatesAvailable:\n      available.length ===\n      probes.length,\n\n    probes,\n\n    safety: {\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionChanged:\n        false,\n    },\n\n    nextGate:\n      available.length ===\n      probes.length\n        ? \"BUILD_EXTENDED_ENTRY_V3_KIS_MINUTE_REPLAY_BATCHER\"\n        : \"DETERMINE_KIS_INTRADAY_RETENTION_BOUNDARY\",\n  };\n\n  fs.writeFileSync(\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v3-kis-intraday-history-range-probe.json\",\n    ),\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_KIS_INTRADAY_HISTORY_RANGE_PROBE_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n",
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V3_KIS_INTRADAY_HISTORY_RANGE_PROBE_INSTALLED',

      generatedFile:
        'scripts/alpha-v3-kis-intraday-history-range-probe.ts',

      productionChanged:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      nextAction:
        'RUN_KIS_INTRADAY_HISTORY_RANGE_PROBE'
    },
    null,
    2,
  ),
);
