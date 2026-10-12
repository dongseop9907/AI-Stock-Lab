#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE_INSTALLER';

const clientAddition =
  "\nexport interface KisDomesticInvestorTradeDailyResponse {\n  rt_cd?: string;\n  msg_cd?: string;\n  msg1?: string;\n\n  output1?:\n    | Record<string, unknown>\n    | Record<string, unknown>[];\n\n  output2?:\n    | Record<string, unknown>\n    | Record<string, unknown>[];\n\n  [key: string]: unknown;\n}\n\nexport interface KisDomesticInvestorTradeDailyResult {\n  body:\n    KisDomesticInvestorTradeDailyResponse;\n\n  trCont:\n    string;\n}\n\n/**\n * \uad6d\ub0b4\uc8fc\uc2dd \uc885\ubaa9\ubcc4 \ud22c\uc790\uc790\ub9e4\ub9e4\ub3d9\ud5a5(\uc77c\ubcc4)\n *\n * Official KIS endpoint:\n *   /uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily\n *\n * TR:\n *   FHPTJ04160001\n *\n * READ ONLY.\n */\nexport async function getDomesticInvestorTradeDaily(\n  stockCode: string,\n  inputDate: string,\n  accessToken: string,\n  trCont = \"\",\n): Promise<KisDomesticInvestorTradeDailyResult> {\n  const normalized =\n    stockCode.trim();\n\n  if (\n    !/^\\d{6}$/.test(\n      normalized,\n    )\n  ) {\n    throw new Error(\n      `INVALID_KIS_STOCK_CODE:${stockCode}`,\n    );\n  }\n\n  const normalizedDate =\n    inputDate\n      .replace(\n        /-/g,\n        \"\",\n      )\n      .trim();\n\n  if (\n    !/^\\d{8}$/.test(\n      normalizedDate,\n    )\n  ) {\n    throw new Error(\n      `INVALID_KIS_INPUT_DATE:${inputDate}`,\n    );\n  }\n\n  const {\n    appKey,\n    appSecret,\n    baseUrl,\n  } =\n    getKisConfig();\n\n  const params =\n    new URLSearchParams({\n      FID_COND_MRKT_DIV_CODE:\n        \"J\",\n\n      FID_INPUT_ISCD:\n        normalized,\n\n      FID_INPUT_DATE_1:\n        normalizedDate,\n\n      FID_ORG_ADJ_PRC:\n        \"\",\n\n      FID_ETC_CLS_CODE:\n        \"\",\n    });\n\n  const headers:\n    Record<\n      string,\n      string\n    > = {\n      \"Content-Type\":\n        \"application/json; charset=utf-8\",\n\n      authorization:\n        `Bearer ${accessToken}`,\n\n      appkey:\n        appKey,\n\n      appsecret:\n        appSecret,\n\n      tr_id:\n        \"FHPTJ04160001\",\n\n      custtype:\n        \"P\",\n    };\n\n  if (\n    trCont\n      .trim()\n      .length >\n      0\n  ) {\n    headers.tr_cont =\n      trCont.trim();\n  }\n\n  const response =\n    await fetch(\n      `${baseUrl}/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily?${params}`,\n      {\n        method:\n          \"GET\",\n\n        headers,\n      },\n    );\n\n  const body =\n    await response.json() as\n      KisDomesticInvestorTradeDailyResponse;\n\n  if (\n    !response.ok\n  ) {\n    throw new Error(\n      `KIS_INVESTOR_DAILY_HTTP_${response.status}:${body.msg_cd ?? \"UNKNOWN\"}:${body.msg1 ?? \"UNKNOWN\"}`,\n    );\n  }\n\n  if (\n    body.rt_cd !==\n      undefined &&\n    body.rt_cd !==\n      \"0\"\n  ) {\n    throw new Error(\n      `KIS_INVESTOR_DAILY_API_ERROR:${body.rt_cd}:${body.msg_cd ?? \"UNKNOWN\"}:${body.msg1 ?? \"UNKNOWN\"}`,\n    );\n  }\n\n  return {\n    body,\n\n    trCont:\n      response.headers\n        .get(\n          \"tr_cont\",\n        ) ??\n      \"\",\n  };\n}\n";

const probeSource =
  "import {\n  getDomesticInvestorTradeDaily,\n  getKisAccessToken,\n} from \"../lib/kis/client\";\n\nconst VERSION =\n  \"ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE\";\n\nconst TARGET_STOCK =\n  \"005930\";\n\nconst TARGET_DATE =\n  \"20260730\";\n\nfunction asText(\n  value: unknown,\n) {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  return String(\n    value,\n  );\n}\n\nfunction rowDate(\n  row:\n    Record<string, unknown>,\n) {\n  return asText(\n    row.stck_bsop_date,\n  );\n}\n\nfunction selectSample(\n  row:\n    Record<string, unknown>,\n) {\n  return {\n    stck_bsop_date:\n      asText(\n        row.stck_bsop_date,\n      ),\n\n    stck_clpr:\n      asText(\n        row.stck_clpr,\n      ),\n\n    prsn_ntby_qty:\n      asText(\n        row.prsn_ntby_qty,\n      ),\n\n    frgn_ntby_qty:\n      asText(\n        row.frgn_ntby_qty,\n      ),\n\n    orgn_ntby_qty:\n      asText(\n        row.orgn_ntby_qty,\n      ),\n\n    prsn_ntby_tr_pbmn:\n      asText(\n        row.prsn_ntby_tr_pbmn,\n      ),\n\n    frgn_ntby_tr_pbmn:\n      asText(\n        row.frgn_ntby_tr_pbmn,\n      ),\n\n    orgn_ntby_tr_pbmn:\n      asText(\n        row.orgn_ntby_tr_pbmn,\n      ),\n  };\n}\n\nasync function main() {\n  const accessToken =\n    await getKisAccessToken();\n\n  const result =\n    await getDomesticInvestorTradeDaily(\n      TARGET_STOCK,\n      TARGET_DATE,\n      accessToken,\n    );\n\n  const body =\n    result.body;\n\n  const output1 =\n    Array.isArray(\n      body.output1,\n    )\n      ? body.output1\n      : body.output1\n      ? [\n          body.output1,\n        ]\n      : [];\n\n  const output2 =\n    Array.isArray(\n      body.output2,\n    )\n      ? body.output2\n      : body.output2\n      ? [\n          body.output2,\n        ]\n      : [];\n\n  const rows =\n    output2 as\n      Record<\n        string,\n        unknown\n      >[];\n\n  const dates =\n    rows\n      .map(\n        rowDate,\n      )\n      .filter(\n        (\n          value,\n        ): value is string =>\n          Boolean(value),\n      )\n      .sort();\n\n  const requestedDatePresent =\n    dates.includes(\n      TARGET_DATE,\n    );\n\n  const historicalRowsAtOrBeforeTarget =\n    dates.filter(\n      (\n        date,\n      ) =>\n        date <=\n        TARGET_DATE,\n    );\n\n  const report = {\n    status:\n      \"ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE_COMPLETE\",\n\n    version:\n      VERSION,\n\n    endpoint: {\n      path:\n        \"/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily\",\n\n      trId:\n        \"FHPTJ04160001\",\n\n      stockCode:\n        TARGET_STOCK,\n\n      inputDate:\n        TARGET_DATE,\n\n      marketDivision:\n        \"J\",\n    },\n\n    response: {\n      rtCd:\n        body.rt_cd ??\n        null,\n\n      msgCd:\n        body.msg_cd ??\n        null,\n\n      msg:\n        body.msg1 ??\n        null,\n\n      trCont:\n        result.trCont,\n\n      output1Rows:\n        output1.length,\n\n      output2Rows:\n        rows.length,\n\n      output2FieldNames:\n        rows[0]\n          ? Object.keys(\n              rows[0],\n            ).sort()\n          : [],\n    },\n\n    historicalCoverage: {\n      earliestReturnedDate:\n        dates[0] ??\n        null,\n\n      latestReturnedDate:\n        dates.at(-1) ??\n        null,\n\n      requestedDatePresent,\n\n      rowsAtOrBeforeRequestedDate:\n        historicalRowsAtOrBeforeTarget\n          .length,\n\n      canReachRequestedHistoricalDate:\n        requestedDatePresent ||\n        historicalRowsAtOrBeforeTarget\n          .length >\n          0,\n    },\n\n    samples:\n      rows\n        .slice(\n          0,\n          5,\n        )\n        .map(\n          selectSample,\n        ),\n\n    decision: {\n      historicalFlowBackfillFeasible:\n        (\n          requestedDatePresent ||\n          historicalRowsAtOrBeforeTarget\n            .length >\n            0\n        ),\n\n      continuationAvailable:\n        Boolean(\n          result.trCont,\n        ),\n\n      nextGate:\n        (\n          requestedDatePresent ||\n          historicalRowsAtOrBeforeTarget\n            .length >\n            0\n        )\n          ? \"ALPHA_V1_DESIGN_KIS_HISTORICAL_FLOW_BACKFILL\"\n          : \"ALPHA_V1_REVIEW_HISTORICAL_FLOW_ALTERNATIVE_SOURCE\",\n    },\n\n    safety: {\n      databaseWrites:\n        0,\n\n      networkRequests:\n        2,\n\n      tokenRequests:\n        1,\n\n      kisHistoricalFlowRequests:\n        1,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n  };\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (\n    error,\n  ) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

function atomicWrite(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
  );

  const temp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    content,
    'utf8',
  );

  fs.renameSync(
    temp,
    file,
  );
}

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const clientFile =
    path.join(
      root,
      'lib',
      'kis',
      'client.ts',
    );

  let clientCode =
    fs.readFileSync(
      clientFile,
      'utf8',
    );

  const marker =
    '/* ALPHA_V1_KIS_INVESTOR_FLOW_END */';

  if (
    !clientCode.includes(
      'export async function getDomesticInvestorTradeDaily(',
    )
  ) {
    const markerCount =
      clientCode
        .split(
          marker,
        )
        .length -
      1;

    if (
      markerCount !==
      1
    ) {
      throw new Error(
        `KIS_FLOW_MARKER_EXPECTED_ONCE_GOT_${markerCount}`,
      );
    }

    clientCode =
      clientCode.replace(
        marker,
        `${clientAddition}\n${marker}`,
      );

    atomicWrite(
      clientFile,
      clientCode,
    );
  }

  const probeFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-kis-historical-investor-flow-probe.ts',
    );

  atomicWrite(
    probeFile,
    probeSource,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE_INSTALLED',

        version:
          VERSION,

        changedFiles: [
          'lib/kis/client.ts',
          'scripts/alpha-v1-kis-historical-investor-flow-probe.ts',
        ],

        newClientFunction: {
          name:
            'getDomesticInvestorTradeDaily',

          endpoint:
            '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',

          trId:
            'FHPTJ04160001',

          dateParameter:
            'FID_INPUT_DATE_1',

          continuationHeaderSupported:
            true,

          readOnly:
            true,
        },

        probe: {
          stockCode:
            '005930',

          inputDate:
            '20260730',

          purpose:
            'PROVE_HISTORICAL_FLOW_RECOVERY_BEYOND_RECENT_30_ROW_WINDOW',
        },

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          productionDecisionApplied:
            false,
        },

        nextAction:
          'RUN_KIS_HISTORICAL_INVESTOR_FLOW_PROBE',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_KIS_HISTORICAL_INVESTOR_FLOW_PROBE_INSTALL_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
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
}
