#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_INSTALLER';

const probe =
  'import fs from "node:fs";\nimport path from "node:path";\n\nimport {\n  getDomesticDailyStockPrices,\n  getKisAccessToken,\n} from "../lib/kis/client";\n\nconst VERSION =\n  "ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE";\n\nconst TARGETS = [\n  "005930",\n  "035420",\n  "035720",\n];\n\nconst START_DATE =\n  "20260601";\n\nconst END_DATE =\n  "20261002";\n\nconst REQUEST_DELAY_MS =\n  1200;\n\nfunction sleep(\n  milliseconds: number,\n) {\n  return new Promise(\n    (resolve) => {\n      setTimeout(\n        resolve,\n        milliseconds,\n      );\n    },\n  );\n}\n\nfunction toNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction compactRow(\n  row: Record<string, unknown>,\n) {\n  return {\n    tradingDate:\n      String(\n        row.stck_bsop_date ??\n        "",\n      ) || null,\n\n    close:\n      toNumber(\n        row.stck_clpr,\n      ),\n\n    open:\n      toNumber(\n        row.stck_oprc,\n      ),\n\n    high:\n      toNumber(\n        row.stck_hgpr,\n      ),\n\n    low:\n      toNumber(\n        row.stck_lwpr,\n      ),\n\n    volume:\n      toNumber(\n        row.acml_vol,\n      ),\n\n    tradingValue:\n      toNumber(\n        row.acml_tr_pbmn,\n      ),\n\n    modified:\n      row.mod_yn ??\n      null,\n  };\n}\n\nasync function main() {\n  const accessToken =\n    await getKisAccessToken();\n\n  const results:\n    Array<Record<string, unknown>> =\n    [];\n\n  let successful = 0;\n  let failed = 0;\n\n  for (\n    let index = 0;\n    index < TARGETS.length;\n    index += 1\n  ) {\n    const stockCode =\n      TARGETS[index];\n\n    try {\n      const response =\n        await getDomesticDailyStockPrices(\n          {\n            stockCode,\n\n            startDate:\n              START_DATE,\n\n            endDate:\n              END_DATE,\n\n            period:\n              "D",\n\n            /**\n             * Existing canonical contract:\n             * adjustedPrice=true -> FID_ORG_ADJ_PRC=0\n             */\n            adjustedPrice:\n              true,\n          },\n          accessToken,\n        );\n\n      const rows =\n        Array.isArray(\n          response.output2,\n        )\n          ? response.output2\n          : [];\n\n      const compact =\n        rows\n          .map(\n            (\n              row:\n              Record<string, unknown>,\n            ) =>\n              compactRow(row),\n          )\n          .filter(\n            (row) =>\n              Boolean(\n                row.tradingDate,\n              ),\n          )\n          .sort(\n            (a, b) =>\n              String(\n                b.tradingDate,\n              ).localeCompare(\n                String(\n                  a.tradingDate,\n                ),\n              ),\n          );\n\n      const uniqueDates =\n        new Set(\n          compact.map(\n            (row) =>\n              row.tradingDate,\n          ),\n        );\n\n      const invalidPriceRows =\n        compact.filter(\n          (row) =>\n            row.close ===\n              null ||\n            row.close <=\n              0 ||\n            row.open ===\n              null ||\n            row.high ===\n              null ||\n            row.low ===\n              null,\n        ).length;\n\n      successful += 1;\n\n      results.push({\n        stockCode,\n\n        status:\n          "OK",\n\n        rtCd:\n          response.rt_cd,\n\n        msgCd:\n          response.msg_cd,\n\n        msg:\n          response.msg1,\n\n        rowCount:\n          compact.length,\n\n        uniqueDateCount:\n          uniqueDates.size,\n\n        duplicateDateCount:\n          compact.length -\n          uniqueDates.size,\n\n        invalidPriceRows,\n\n        latest:\n          compact[0] ??\n          null,\n\n        oldest:\n          compact.at(-1) ??\n          null,\n\n        sampleLatest:\n          compact.slice(\n            0,\n            5,\n          ),\n\n        enoughFor20Day:\n          compact.length >=\n          20,\n\n        enoughFor60Day:\n          compact.length >=\n          60,\n      });\n    } catch (error) {\n      failed += 1;\n\n      results.push({\n        stockCode,\n\n        status:\n          "FAILED",\n\n        error:\n          String(\n            error instanceof Error\n              ? error.message\n              : error,\n          ),\n      });\n    }\n\n    if (\n      index <\n      TARGETS.length - 1\n    ) {\n      await sleep(\n        REQUEST_DELAY_MS,\n      );\n    }\n  }\n\n  const allUsable =\n    results.every(\n      (row) =>\n        row.status ===\n          "OK" &&\n        row.enoughFor60Day ===\n          true &&\n        Number(\n          row.invalidPriceRows ??\n          1,\n        ) ===\n          0 &&\n        Number(\n          row.duplicateDateCount ??\n          1,\n        ) ===\n          0,\n    );\n\n  const report = {\n    status:\n      allUsable\n        ? "ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_COMPLETE"\n        : "ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_COMPLETE_WITH_GAPS",\n\n    version:\n      VERSION,\n\n    request: {\n      targets:\n        TARGETS,\n\n      startDate:\n        START_DATE,\n\n      endDate:\n        END_DATE,\n\n      period:\n        "D",\n\n      adjustedPrice:\n        true,\n\n      canonicalKisMode:\n        "FID_ORG_ADJ_PRC=0",\n    },\n\n    counts: {\n      requested:\n        TARGETS.length,\n\n      successful,\n\n      failed,\n\n      usableFor60DayAlpha:\n        results.filter(\n          (row) =>\n            row.status ===\n              "OK" &&\n            row.enoughFor60Day ===\n              true &&\n            Number(\n              row.invalidPriceRows ??\n              1,\n            ) ===\n              0 &&\n            Number(\n              row.duplicateDateCount ??\n              1,\n            ) ===\n              0,\n        ).length,\n    },\n\n    results,\n\n    conclusion: {\n      kisSurfaceAvailable:\n        successful ===\n        TARGETS.length,\n\n      safeToPrepareControlledBackfill:\n        allUsable,\n\n      databaseWriteAllowedNow:\n        false,\n\n      reason:\n        allUsable\n          ? "KIS_ADJUSTED_DAILY_SURFACE_VALIDATED_FOR_ALL_MISSING_ALPHA_STOCKS"\n          : "KIS_DAILY_SURFACE_MUST_BE_REVIEWED_BEFORE_ANY_BACKFILL",\n    },\n\n    safety: {\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      kisDailyRequests:\n        TARGETS.length,\n\n      tokenRequest:\n        "GET_KIS_ACCESS_TOKEN_MAY_ISSUE_ONE_TOKEN_REQUEST",\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      allUsable\n        ? "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN"\n        : "REVIEW_KIS_MISSING_DAILY_BAR_SURFACE",\n  };\n\n  const outputFile =\n    path.resolve(\n      process.cwd(),\n      "logs",\n      "alpha-v1-missing-daily-bar-kis-probe.json",\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + "\\n",\n    "utf8",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n\n  if (\n    successful === 0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            "ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_FAILED",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            ordersCreated:\n              0,\n\n            productionDecisionApplied:\n              false,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n';

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

  atomicWrite(
    path.join(
      root,
      'scripts',
      'alpha-v1-missing-daily-bar-kis-probe.ts',
    ),
    probe,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_INSTALLED',

        version:
          VERSION,

        file:
          'scripts/alpha-v1-missing-daily-bar-kis-probe.ts',

        targets: [
          '005930',
          '035420',
          '035720',
        ],

        contract: {
          period:
            'D',

          adjustedPrice:
            true,

          kisMode:
            'FID_ORG_ADJ_PRC=0',

          databaseWrites:
            0,
        },

        nextAction:
          'RUN_ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE',
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
          'ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_INSTALL_FAILED',

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
