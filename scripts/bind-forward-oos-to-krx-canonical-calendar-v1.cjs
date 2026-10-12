const fs = require("fs");
const path = require("path");

const root = process.cwd();

const producerRel =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";

const producerPath =
  path.resolve(
    root,
    producerRel,
  );

const canonicalPath =
  path.resolve(
    root,
    "lib/trading/krx-trading-calendar.ts",
  );

if (!fs.existsSync(producerPath)) {
  throw new Error(
    "FORWARD_PRODUCER_NOT_FOUND",
  );
}

if (!fs.existsSync(canonicalPath)) {
  throw new Error(
    "CANONICAL_KRX_CALENDAR_NOT_FOUND",
  );
}

let source =
  fs.readFileSync(
    producerPath,
    "utf8",
  );

const IMPORT_MARKER =
  'from "../lib/trading/krx-trading-calendar";';

if (!source.includes(IMPORT_MARKER)) {
  const firstImportEnd =
    source.indexOf(";\n");

  if (firstImportEnd < 0) {
    throw new Error(
      "IMPORT_INSERTION_POINT_NOT_FOUND",
    );
  }

  const importBlock = `

import {
  nextKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";
`;

  source =
    source.slice(
      0,
      firstImportEnd + 2,
    ) +
    importBlock +
    source.slice(
      firstImportEnd + 2,
    );
}

const startMarker =
  "function nextExpectedKrxOpenDateBase(";

const endMarker =
  "export function classifyCaptureWindow(";

const start =
  source.indexOf(
    startMarker,
  );

const end =
  source.indexOf(
    endMarker,
  );

if (start < 0) {
  if (
    !source.includes(
      "return nextKrxTradingDate(",
    )
  ) {
    throw new Error(
      "FORWARD_CALENDAR_BLOCK_START_NOT_FOUND",
    );
  }
} else {
  if (
    end < 0 ||
    end <= start
  ) {
    throw new Error(
      "FORWARD_CALENDAR_BLOCK_END_NOT_FOUND",
    );
  }

  const replacement = `export function nextExpectedKrxOpenDate(
  sourceTradingDate: string,
  overrides: CalendarOverrideRow[],
) {
  return nextKrxTradingDate(
    sourceTradingDate,
    overrides,
  );
}

`;

  source =
    source.slice(0, start) +
    replacement +
    source.slice(end);
}

fs.writeFileSync(
  producerPath,
  source,
  "utf8",
);

const after =
  fs.readFileSync(
    producerPath,
    "utf8",
  );

const checks = {
  canonicalImportPresent:
    after.includes(
      IMPORT_MARKER,
    ),

  canonicalFunctionUsed:
    after.includes(
      "return nextKrxTradingDate(",
    ),

  legacyBaseResolverRemoved:
    !after.includes(
      "function nextExpectedKrxOpenDateBase(",
    ),

  duplicateBuiltInClosureRemoved:
    !after.includes(
      "FORWARD_VERIFIED_KRX_CLOSURES_V1",
    ),

  directWeekdayFallbackRemovedFromResolverArea:
    !after.includes(
      "NEXT_KRX_OPEN_DATE_NOT_FOUND",
    ),

  publicCompatibilityExportPreserved:
    after.includes(
      "export function nextExpectedKrxOpenDate(",
    ),

  targetSessionCalculationPreserved:
    after.includes(
      "const targetSessionDate =",
    ) &&
    after.includes(
      "nextExpectedKrxOpenDate(",
    ),

  alphaThresholdLiteralPreserved:
    after.includes(
      "entryScoreThreshold"
    ),

  historicalCutoffSurfacePreserved:
    after.includes(
      "historicalCutoff"
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "FORWARD_OOS_KRX_CANONICAL_CALENDAR_V1_BOUND"
          : "FORWARD_OOS_KRX_CANONICAL_CALENDAR_V1_REVIEW",

      modifiedFile:
        producerRel,

      binding: {
        compatibilityExport:
          "nextExpectedKrxOpenDate",

        canonicalImplementation:
          "nextKrxTradingDate",

        canonicalModule:
          "lib/trading/krx-trading-calendar.ts",

        runtimeDbOverridesPreserved:
          true,

        builtInHangeulClosureNowOwnedByCanonicalModule:
          true,
      },

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        forwardStateWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        schedulerChanged: false,
        realTradingChanged: false,
        alphaParametersChanged: false,
      },

      nextGate:
        failed.length === 0
          ? "RUN_CANONICAL_CONTRACT_AND_FORWARD_CONTRACT_STATIC_SMOKE"
          : "REVIEW_FORWARD_CANONICAL_BINDING",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
