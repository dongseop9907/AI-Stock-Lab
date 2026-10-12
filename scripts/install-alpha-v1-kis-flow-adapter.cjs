#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_KIS_FLOW_ADAPTER_INSTALLER';

const adapter =
  "import type {\n  AlphaFeatureEvidence,\n} from \"./candidate-scoring\";\n\nimport type {\n  KisDomesticInvestorTrendOutput,\n} from \"../kis/client\";\n\nexport interface KisInvestorFlowAdapterInput {\n  decisionAt: string;\n  rows: KisDomesticInvestorTrendOutput[];\n  lookbackRows?: number;\n}\n\nfunction clamp01(value: number): number {\n  return Math.min(1, Math.max(0, value));\n}\n\nfunction toNumber(value: unknown): number | null {\n  if (value === null || value === undefined) {\n    return null;\n  }\n\n  const parsed = Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction parseDecisionAt(value: string): number {\n  const parsed = new Date(value).getTime();\n\n  if (!Number.isFinite(parsed)) {\n    throw new Error(\n      `INVALID_DECISION_AT:${value}`,\n    );\n  }\n\n  return parsed;\n}\n\nfunction tradingDateToConservativeAvailableAt(\n  yyyymmdd: string,\n): string | null {\n  if (!/^\\d{8}$/.test(yyyymmdd)) {\n    return null;\n  }\n\n  const year =\n    Number(yyyymmdd.slice(0, 4));\n\n  const month =\n    Number(yyyymmdd.slice(4, 6));\n\n  const day =\n    Number(yyyymmdd.slice(6, 8));\n\n  /**\n   * Conservative availability contract:\n   * treat a Korean trading day's final investor-flow aggregate as\n   * available only at the next 00:00 KST.\n   *\n   * 00:00 KST of the following calendar day = 15:00 UTC on trading date.\n   *\n   * This automatically prevents the still-open/current trading day's\n   * placeholder zero row from leaking into a decision made during the day.\n   */\n  const utcMs =\n    Date.UTC(\n      year,\n      month - 1,\n      day,\n      15,\n      0,\n      0,\n      0,\n    );\n\n  const date =\n    new Date(utcMs);\n\n  return Number.isFinite(date.getTime())\n    ? date.toISOString()\n    : null;\n}\n\nfunction flowValues(\n  row: KisDomesticInvestorTrendOutput,\n) {\n  const foreignAmount =\n    toNumber(\n      row.frgn_ntby_tr_pbmn,\n    );\n\n  const institutionAmount =\n    toNumber(\n      row.orgn_ntby_tr_pbmn,\n    );\n\n  const individualAmount =\n    toNumber(\n      row.prsn_ntby_tr_pbmn,\n    );\n\n  const amountUsable =\n    foreignAmount !== null ||\n    institutionAmount !== null ||\n    individualAmount !== null;\n\n  if (amountUsable) {\n    return {\n      basis:\n        \"NET_BUY_TRADING_AMOUNT\" as const,\n\n      foreign:\n        foreignAmount ?? 0,\n\n      institution:\n        institutionAmount ?? 0,\n\n      individual:\n        individualAmount ?? 0,\n    };\n  }\n\n  return {\n    basis:\n      \"NET_BUY_QUANTITY_FALLBACK\" as const,\n\n    foreign:\n      toNumber(\n        row.frgn_ntby_qty,\n      ) ?? 0,\n\n    institution:\n      toNumber(\n        row.orgn_ntby_qty,\n      ) ?? 0,\n\n    individual:\n      toNumber(\n        row.prsn_ntby_qty,\n      ) ?? 0,\n  };\n}\n\nexport function buildKisInvestorFlowEvidence(\n  input: KisInvestorFlowAdapterInput,\n): AlphaFeatureEvidence | undefined {\n  const decisionAtMs =\n    parseDecisionAt(\n      input.decisionAt,\n    );\n\n  const lookbackRows =\n    Math.max(\n      3,\n      Math.min(\n        20,\n        Math.floor(\n          input.lookbackRows ?? 7,\n        ),\n      ),\n    );\n\n  const usable =\n    input.rows\n      .map((row) => {\n        const tradingDate =\n          String(\n            row.stck_bsop_date ?? \"\",\n          ).trim();\n\n        const availableAt =\n          tradingDateToConservativeAvailableAt(\n            tradingDate,\n          );\n\n        const availableAtMs =\n          availableAt\n            ? new Date(\n                availableAt,\n              ).getTime()\n            : Number.NaN;\n\n        const values =\n          flowValues(row);\n\n        const smartMoneyNet =\n          values.foreign +\n          values.institution;\n\n        const grossParticipantNet =\n          Math.abs(\n            values.foreign,\n          ) +\n          Math.abs(\n            values.institution,\n          ) +\n          Math.abs(\n            values.individual,\n          );\n\n        const normalized =\n          grossParticipantNet > 0\n            ? Math.max(\n                -1,\n                Math.min(\n                  1,\n                  smartMoneyNet /\n                    grossParticipantNet,\n                ),\n              )\n            : 0;\n\n        return {\n          row,\n          tradingDate,\n          availableAt,\n          availableAtMs,\n          basis:\n            values.basis,\n          foreign:\n            values.foreign,\n          institution:\n            values.institution,\n          individual:\n            values.individual,\n          smartMoneyNet,\n          grossParticipantNet,\n          normalized,\n        };\n      })\n      .filter(\n        (row) =>\n          row.availableAt !== null &&\n          Number.isFinite(\n            row.availableAtMs,\n          ) &&\n          row.availableAtMs <=\n            decisionAtMs &&\n          row.grossParticipantNet > 0,\n      )\n      .sort(\n        (a, b) =>\n          b.tradingDate.localeCompare(\n            a.tradingDate,\n          ),\n      )\n      .slice(\n        0,\n        lookbackRows,\n      );\n\n  if (usable.length === 0) {\n    return undefined;\n  }\n\n  let weightedNormalized = 0;\n  let totalWeight = 0;\n  let positiveWeight = 0;\n  let negativeWeight = 0;\n\n  usable.forEach(\n    (row, index) => {\n      /**\n       * Newer completed trading days matter more.\n       */\n      const recencyWeight =\n        Math.pow(\n          0.78,\n          index,\n        );\n\n      weightedNormalized +=\n        row.normalized *\n        recencyWeight;\n\n      totalWeight +=\n        recencyWeight;\n\n      if (\n        row.smartMoneyNet > 0\n      ) {\n        positiveWeight +=\n          recencyWeight;\n      } else if (\n        row.smartMoneyNet < 0\n      ) {\n        negativeWeight +=\n          recencyWeight;\n      }\n    },\n  );\n\n  if (totalWeight <= 0) {\n    return undefined;\n  }\n\n  const meanNormalized =\n    weightedNormalized /\n    totalWeight;\n\n  const directionalWeight =\n    positiveWeight +\n    negativeWeight;\n\n  const signedConsistency =\n    directionalWeight > 0\n      ? (\n          positiveWeight -\n          negativeWeight\n        ) /\n        directionalWeight\n      : 0;\n\n  const pressureScore =\n    clamp01(\n      0.5 +\n      meanNormalized *\n        0.5,\n    );\n\n  const consistencyScore =\n    clamp01(\n      0.5 +\n      signedConsistency *\n        0.5,\n    );\n\n  /**\n   * 75% actual normalized smart-money pressure\n   * 25% directional persistence.\n   */\n  const score =\n    clamp01(\n      pressureScore *\n        0.75 +\n      consistencyScore *\n        0.25,\n    );\n\n  const amountRows =\n    usable.filter(\n      (row) =>\n        row.basis ===\n        \"NET_BUY_TRADING_AMOUNT\",\n    ).length;\n\n  const amountCoverage =\n    amountRows /\n    usable.length;\n\n  const historyCoverage =\n    clamp01(\n      usable.length /\n      lookbackRows,\n    );\n\n  const nonZeroDirectionCoverage =\n    directionalWeight > 0\n      ? 1\n      : 0;\n\n  const confidence =\n    clamp01(\n      0.45 +\n      amountCoverage *\n        0.20 +\n      historyCoverage *\n        0.20 +\n      nonZeroDirectionCoverage *\n        0.10,\n    );\n\n  const latest =\n    usable[0];\n\n  return {\n    score,\n    confidence,\n\n    availableAt:\n      latest.availableAt as string,\n\n    observedAt:\n      latest.availableAt as string,\n\n    source:\n      \"KIS_INQUIRE_INVESTOR\",\n\n    sourceVersion:\n      \"FHKST01010900_ALPHA_FLOW_V1\",\n\n    /**\n     * Allows long weekends/holidays while still rejecting very stale flow.\n     */\n    maxAgeMinutes:\n      10 * 24 * 60,\n\n    metadata: {\n      lookbackRows,\n      usableRows:\n        usable.length,\n\n      latestCompletedTradingDate:\n        latest.tradingDate,\n\n      amountRows,\n      quantityFallbackRows:\n        usable.length -\n        amountRows,\n\n      meanNormalized,\n      signedConsistency,\n      pressureScore,\n      consistencyScore,\n\n      positiveWeight,\n      negativeWeight,\n\n      rows:\n        usable.map(\n          (row) => ({\n            tradingDate:\n              row.tradingDate,\n\n            availableAt:\n              row.availableAt,\n\n            basis:\n              row.basis,\n\n            foreign:\n              row.foreign,\n\n            institution:\n              row.institution,\n\n            individual:\n              row.individual,\n\n            smartMoneyNet:\n              row.smartMoneyNet,\n\n            normalized:\n              row.normalized,\n          }),\n        ),\n    },\n  };\n}\n";

const smoke =
  "import assert from \"node:assert/strict\";\n\nimport {\n  buildKisInvestorFlowEvidence,\n} from \"../lib/alpha/kis-flow-adapter\";\n\nconst decisionAt =\n  \"2026-10-06T05:45:00.000Z\";\n\nconst evidence =\n  buildKisInvestorFlowEvidence({\n    decisionAt,\n\n    lookbackRows:\n      5,\n\n    rows: [\n      /**\n       * Current trading day placeholder.\n       * Conservative availability contract must exclude it.\n       */\n      {\n        stck_bsop_date:\n          \"20261006\",\n\n        frgn_ntby_tr_pbmn:\n          0,\n\n        orgn_ntby_tr_pbmn:\n          0,\n\n        prsn_ntby_tr_pbmn:\n          0,\n      },\n\n      {\n        stck_bsop_date:\n          \"20261002\",\n\n        frgn_ntby_tr_pbmn:\n          -120,\n\n        orgn_ntby_tr_pbmn:\n          220,\n\n        prsn_ntby_tr_pbmn:\n          -100,\n      },\n\n      {\n        stck_bsop_date:\n          \"20261001\",\n\n        frgn_ntby_tr_pbmn:\n          50,\n\n        orgn_ntby_tr_pbmn:\n          150,\n\n        prsn_ntby_tr_pbmn:\n          -200,\n      },\n\n      {\n        stck_bsop_date:\n          \"20260930\",\n\n        frgn_ntby_tr_pbmn:\n          -40,\n\n        orgn_ntby_tr_pbmn:\n          120,\n\n        prsn_ntby_tr_pbmn:\n          -80,\n      },\n\n      {\n        stck_bsop_date:\n          \"20260929\",\n\n        frgn_ntby_tr_pbmn:\n          80,\n\n        orgn_ntby_tr_pbmn:\n          100,\n\n        prsn_ntby_tr_pbmn:\n          -180,\n      },\n\n      {\n        stck_bsop_date:\n          \"20260928\",\n\n        frgn_ntby_tr_pbmn:\n          90,\n\n        orgn_ntby_tr_pbmn:\n          110,\n\n        prsn_ntby_tr_pbmn:\n          -200,\n      },\n    ],\n  });\n\nassert(\n  evidence,\n  \"flow evidence missing\",\n);\n\nassert.equal(\n  evidence.source,\n  \"KIS_INQUIRE_INVESTOR\",\n);\n\nassert.equal(\n  evidence.metadata\n    ?.latestCompletedTradingDate,\n  \"20261002\",\n  \"current trading day leaked into completed flow evidence\",\n);\n\nassert.equal(\n  evidence.metadata\n    ?.usableRows,\n  5,\n);\n\nassert(\n  evidence.score >\n    0.5,\n  \"positive smart-money history should score above neutral\",\n);\n\nassert(\n  evidence.confidence >=\n    0.8,\n  \"five amount-based rows should have high confidence\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        \"ALPHA_V1_KIS_FLOW_ADAPTER_SMOKE_PASS\",\n\n      score:\n        evidence.score,\n\n      confidence:\n        evidence.confidence,\n\n      availableAt:\n        evidence.availableAt,\n\n      metadata:\n        evidence.metadata,\n\n      safety: {\n        databaseReads:\n          0,\n\n        databaseWrites:\n          0,\n\n        networkRequests:\n          0,\n\n        ordersCreated:\n          0,\n      },\n\n      nextGate:\n        \"ALPHA_V1_BIND_KIS_FLOW_TO_REAL_RUNNER\",\n    },\n    null,\n    2,\n  ),\n);\n";

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
      'lib',
      'alpha',
      'kis-flow-adapter.ts',
    ),
    adapter,
  );

  atomicWrite(
    path.join(
      root,
      'scripts',
      'alpha-v1-kis-flow-adapter-smoke.ts',
    ),
    smoke,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_KIS_FLOW_ADAPTER_INSTALLED',

        version:
          VERSION,

        files: [
          'lib/alpha/kis-flow-adapter.ts',
          'scripts/alpha-v1-kis-flow-adapter-smoke.ts',
        ],

        contract: {
          source:
            'KIS_INQUIRE_INVESTOR',

          trId:
            'FHKST01010900',

          preferredBasis:
            'NET_BUY_TRADING_AMOUNT',

          fallbackBasis:
            'NET_BUY_QUANTITY',

          lookbackRows:
            7,

          currentTradingDay:
            'EXCLUDED_BY_CONSERVATIVE_AVAILABILITY',

          weightsChanged:
            false,

          alphaFlowWeight:
            0.20,
        },

        safety: {
          databaseReads:
            0,

          databaseWrites:
            0,

          networkRequests:
            0,

          ordersCreated:
            0,
        },

        nextAction:
          'RUN_ALPHA_V1_KIS_FLOW_ADAPTER_SMOKE',
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
          'ALPHA_V1_KIS_FLOW_ADAPTER_INSTALL_FAILED',

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
