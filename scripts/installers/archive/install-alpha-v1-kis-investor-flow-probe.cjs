#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_INSTALLER';

const CLIENT_MARKER =
  'ALPHA_V1_KIS_INVESTOR_FLOW_BEGIN';

const clientBlock =
  "\n/* ALPHA_V1_KIS_INVESTOR_FLOW_BEGIN */\n\nexport interface KisDomesticInvestorTrendOutput {\n  stck_bsop_date?: string | null;\n  stck_clpr?: string | number | null;\n  prdy_vrss?: string | number | null;\n  prdy_ctrt?: string | number | null;\n  acml_vol?: string | number | null;\n  acml_tr_pbmn?: string | number | null;\n\n  prsn_ntby_qty?: string | number | null;\n  frgn_ntby_qty?: string | number | null;\n  orgn_ntby_qty?: string | number | null;\n\n  frgn_reg_ntby_qty?: string | number | null;\n  frgn_nreg_ntby_qty?: string | number | null;\n  scrt_ntby_qty?: string | number | null;\n  ivtr_ntby_qty?: string | number | null;\n  pe_fund_ntby_vol?: string | number | null;\n  bank_ntby_qty?: string | number | null;\n  insu_ntby_qty?: string | number | null;\n  mrbn_ntby_qty?: string | number | null;\n\n  [key: string]: unknown;\n}\n\nexport interface KisDomesticInvestorTrendResponse {\n  rt_cd?: string;\n  msg_cd?: string;\n  msg1?: string;\n  output?: KisDomesticInvestorTrendOutput[];\n  [key: string]: unknown;\n}\n\n/**\n * \uad6d\ub0b4\uc8fc\uc2dd \uc885\ubaa9\ubcc4 \ud22c\uc790\uc790 \ub9e4\ub9e4\ub3d9\ud5a5\n *\n * Official KIS endpoint:\n *   /uapi/domestic-stock/v1/quotations/inquire-investor\n *\n * TR:\n *   FHKST01010900\n *\n * READ ONLY.\n */\nexport async function getDomesticInvestorTrend(\n  stockCode: string,\n  accessToken: string,\n): Promise<KisDomesticInvestorTrendResponse> {\n  const normalized =\n    stockCode.trim();\n\n  if (!/^\\d{6}$/.test(normalized)) {\n    throw new Error(\n      `INVALID_KIS_STOCK_CODE:${stockCode}`,\n    );\n  }\n\n  const {\n    appKey,\n    appSecret,\n    baseUrl,\n  } =\n    getKisConfig();\n\n  const params =\n    new URLSearchParams({\n      FID_COND_MRKT_DIV_CODE:\n        \"J\",\n\n      FID_INPUT_ISCD:\n        normalized,\n    });\n\n  const response =\n    await fetch(\n      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-investor?${params}`,\n      {\n        method:\n          \"GET\",\n\n        headers: {\n          \"Content-Type\":\n            \"application/json; charset=utf-8\",\n\n          authorization:\n            `Bearer ${accessToken}`,\n\n          appkey:\n            appKey,\n\n          appsecret:\n            appSecret,\n\n          tr_id:\n            \"FHKST01010900\",\n\n          custtype:\n            \"P\",\n        },\n      },\n    );\n\n  const body =\n    await response.json() as\n      KisDomesticInvestorTrendResponse;\n\n  if (!response.ok) {\n    throw new Error(\n      `KIS_INVESTOR_HTTP_${response.status}:${body.msg_cd ?? \"UNKNOWN\"}:${body.msg1 ?? \"UNKNOWN\"}`,\n    );\n  }\n\n  if (\n    body.rt_cd !== undefined &&\n    body.rt_cd !== \"0\"\n  ) {\n    throw new Error(\n      `KIS_INVESTOR_API_ERROR:${body.rt_cd}:${body.msg_cd ?? \"UNKNOWN\"}:${body.msg1 ?? \"UNKNOWN\"}`,\n    );\n  }\n\n  return body;\n}\n\n/* ALPHA_V1_KIS_INVESTOR_FLOW_END */\n";

const probe =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  getDomesticInvestorTrend,\n  getKisAccessToken,\n  type KisDomesticInvestorTrendOutput,\n} from \"../lib/kis/client\";\n\nconst VERSION =\n  \"ALPHA_V1_KIS_INVESTOR_FLOW_PROBE\";\n\nconst STOCKS = [\n  \"000660\",\n  \"005380\",\n  \"005930\",\n  \"035420\",\n  \"035720\",\n];\n\nconst REQUEST_DELAY_MS =\n  700;\n\nfunction sleep(\n  milliseconds: number,\n) {\n  return new Promise(\n    (resolve) => {\n      setTimeout(\n        resolve,\n        milliseconds,\n      );\n    },\n  );\n}\n\nfunction toNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction pickRow(\n  row: KisDomesticInvestorTrendOutput,\n) {\n  return {\n    date:\n      row.stck_bsop_date ??\n      null,\n\n    close:\n      toNumber(\n        row.stck_clpr,\n      ),\n\n    volume:\n      toNumber(\n        row.acml_vol,\n      ),\n\n    turnover:\n      toNumber(\n        row.acml_tr_pbmn,\n      ),\n\n    foreignNetBuyQty:\n      toNumber(\n        row.frgn_ntby_qty,\n      ),\n\n    institutionNetBuyQty:\n      toNumber(\n        row.orgn_ntby_qty,\n      ),\n\n    individualNetBuyQty:\n      toNumber(\n        row.prsn_ntby_qty,\n      ),\n  };\n}\n\nasync function main() {\n  const accessToken =\n    await getKisAccessToken();\n\n  const results:\n    Array<Record<string, unknown>> =\n    [];\n\n  let successfulRequests =\n    0;\n\n  let failedRequests =\n    0;\n\n  for (\n    let index = 0;\n    index < STOCKS.length;\n    index += 1\n  ) {\n    const stockCode =\n      STOCKS[index];\n\n    try {\n      const response =\n        await getDomesticInvestorTrend(\n          stockCode,\n          accessToken,\n        );\n\n      successfulRequests += 1;\n\n      const rows =\n        Array.isArray(\n          response.output,\n        )\n          ? response.output\n          : [];\n\n      const fieldNames =\n        [\n          ...new Set(\n            rows\n              .slice(0, 5)\n              .flatMap(\n                (row) =>\n                  Object.keys(row),\n              ),\n          ),\n        ].sort();\n\n      const compactRows =\n        rows\n          .slice(0, 10)\n          .map(\n            pickRow,\n          );\n\n      const usableFlowRows =\n        compactRows.filter(\n          (row) =>\n            row.foreignNetBuyQty !==\n              null ||\n            row.institutionNetBuyQty !==\n              null,\n        );\n\n      results.push({\n        stockCode,\n\n        status:\n          \"OK\",\n\n        rtCd:\n          response.rt_cd ??\n          null,\n\n        msgCd:\n          response.msg_cd ??\n          null,\n\n        msg:\n          response.msg1 ??\n          null,\n\n        rowCount:\n          rows.length,\n\n        fieldNames,\n\n        latestRows:\n          compactRows,\n\n        usableFlowRows:\n          usableFlowRows.length,\n\n        latestDate:\n          compactRows[0]\n            ?.date ??\n          null,\n      });\n    } catch (error) {\n      failedRequests += 1;\n\n      results.push({\n        stockCode,\n\n        status:\n          \"FAILED\",\n\n        error:\n          String(\n            error instanceof Error\n              ? error.message\n              : error,\n          ),\n      });\n    }\n\n    if (\n      index <\n      STOCKS.length - 1\n    ) {\n      await sleep(\n        REQUEST_DELAY_MS,\n      );\n    }\n  }\n\n  const successful =\n    results.filter(\n      (row) =>\n        row.status ===\n        \"OK\",\n    );\n\n  const usableStocks =\n    successful.filter(\n      (row) =>\n        Number(\n          row.usableFlowRows ??\n          0,\n        ) > 0,\n    );\n\n  const report = {\n    status:\n      failedRequests === 0 &&\n      usableStocks.length ===\n        STOCKS.length\n        ? \"ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_COMPLETE\"\n        : \"ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_COMPLETE_WITH_GAPS\",\n\n    version:\n      VERSION,\n\n    endpoint: {\n      path:\n        \"/uapi/domestic-stock/v1/quotations/inquire-investor\",\n\n      trId:\n        \"FHKST01010900\",\n\n      marketDivision:\n        \"J\",\n    },\n\n    requestedStocks:\n      STOCKS,\n\n    counts: {\n      requested:\n        STOCKS.length,\n\n      successfulRequests,\n\n      failedRequests,\n\n      stocksWithUsableFlow:\n        usableStocks.length,\n    },\n\n    results,\n\n    interpretation: {\n      canBindFlowFeature:\n        usableStocks.length ===\n        STOCKS.length,\n\n      expectedCoreFields: [\n        \"stck_bsop_date\",\n        \"acml_vol\",\n        \"frgn_ntby_qty\",\n        \"orgn_ntby_qty\",\n        \"prsn_ntby_qty\",\n      ],\n\n      nextIfUsable:\n        \"BUILD_ALPHA_V1_KIS_FLOW_EVIDENCE_ADAPTER\",\n\n      nextIfGap:\n        \"REVIEW_KIS_PAYLOAD_OR_PERMISSION_WITHOUT_FABRICATING_FLOW\",\n    },\n\n    safety: {\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      kisInvestorRequests:\n        STOCKS.length,\n\n      tokenRequest:\n        \"GET_KIS_ACCESS_TOKEN_MAY_ISSUE_ONE_TOKEN_REQUEST\",\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    outputFile:\n      \"logs/alpha-v1-kis-investor-flow-probe.json\",\n  };\n\n  const outputFile =\n    path.resolve(\n      process.cwd(),\n      report.outputFile,\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile,\n    ),\n    {\n      recursive: true,\n    },\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n\n  if (\n    successfulRequests === 0\n  ) {\n    process.exitCode = 2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            ordersCreated:\n              0,\n\n            productionDecisionApplied:\n              false,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 2;\n  },\n);\n";

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

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    content,
    'utf8',
  );

  fs.renameSync(
    tmp,
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

  const probeFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-kis-investor-flow-probe.ts',
    );

  if (
    !fs.existsSync(
      clientFile,
    )
  ) {
    throw new Error(
      `FILE_NOT_FOUND:${clientFile}`,
    );
  }

  const before =
    fs.readFileSync(
      clientFile,
      'utf8',
    );

  let clientChanged =
    false;

  if (
    !before.includes(
      CLIENT_MARKER,
    )
  ) {
    atomicWrite(
      clientFile,
      `${before.trimEnd()}\n\n${clientBlock.trim()}\n`,
    );

    clientChanged =
      true;
  }

  atomicWrite(
    probeFile,
    probe,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_INSTALLED',

        version:
          VERSION,

        changedFiles: [
          ...(clientChanged
            ? ['lib/kis/client.ts']
            : []),
          'scripts/alpha-v1-kis-investor-flow-probe.ts',
        ],

        clientFunction: {
          name:
            'getDomesticInvestorTrend',

          endpoint:
            '/uapi/domestic-stock/v1/quotations/inquire-investor',

          trId:
            'FHKST01010900',
        },

        probeStocks: [
          '000660',
          '005380',
          '005930',
          '035420',
          '035720',
        ],

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          productionDecisionApplied:
            false,
        },

        nextAction:
          'RUN_ALPHA_V1_KIS_INVESTOR_FLOW_PROBE',
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
          'ALPHA_V1_KIS_INVESTOR_FLOW_PROBE_INSTALL_FAILED',

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

  process.exitCode = 2;
}
