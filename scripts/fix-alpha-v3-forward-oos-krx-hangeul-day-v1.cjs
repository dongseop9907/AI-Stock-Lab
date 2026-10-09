const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();

const producerPath = path.resolve(
  root,
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
);

const contractPath = path.resolve(
  root,
  "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts",
);

if (!fs.existsSync(producerPath)) {
  throw new Error("FORWARD_PRODUCER_NOT_FOUND");
}

if (!fs.existsSync(contractPath)) {
  throw new Error("FORWARD_CONTRACT_NOT_FOUND");
}

function findFunctionEnd(source, declarationStart) {
  const braceStart =
    source.indexOf("{", declarationStart);

  if (braceStart < 0) {
    throw new Error(
      "FUNCTION_OPEN_BRACE_NOT_FOUND",
    );
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (
    let i = braceStart;
    i < source.length;
    i += 1
  ) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      if (
        ch === "*" &&
        next === "/"
      ) {
        inBlockComment = false;
        i += 1;
      }

      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (
      ch === "/" &&
      next === "/"
    ) {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (
      ch === "/" &&
      next === "*"
    ) {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (
      ch === '"' ||
      ch === "'" ||
      ch === "`"
    ) {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        return i + 1;
      }
    }
  }

  throw new Error(
    "FUNCTION_CLOSE_BRACE_NOT_FOUND",
  );
}

let producer =
  fs.readFileSync(
    producerPath,
    "utf8",
  );

const marker =
  "ALPHA_V3_FORWARD_OOS_KRX_HANGEUL_DAY_V1";

if (!producer.includes(marker)) {
  const decl =
    "export function nextExpectedKrxOpenDate(";

  const declarationStart =
    producer.indexOf(decl);

  if (declarationStart < 0) {
    throw new Error(
      "NEXT_EXPECTED_KRX_OPEN_DATE_EXPORT_NOT_FOUND",
    );
  }

  const functionEnd =
    findFunctionEnd(
      producer,
      declarationStart,
    );

  producer =
    producer.slice(
      0,
      declarationStart,
    ) +
    producer
      .slice(
        declarationStart,
        functionEnd,
      )
      .replace(
        decl,
        "function nextExpectedKrxOpenDateBase(",
      ) +
    `

/*
 * ${marker}
 *
 * Forward OOS must never infer a Korean public holiday as an
 * exchange session merely because it falls on Monday-Friday.
 *
 * This layer is intentionally narrow and immutable for the
 * already-known 2026 Hangeul Day closure. DB calendar overrides
 * are still used for all other verified exchange-calendar facts.
 *
 * This does NOT change Alpha scoring, Entry V3 threshold,
 * premium cap, historical cutoff, or any future outcome logic.
 */
const FORWARD_VERIFIED_KRX_CLOSURES_V1:
  CalendarOverrideRow[] = [
    {
      calendar_date:
        "2026-10-09",

      is_open:
        false,

      verified:
        true,
    },
  ];

export function nextExpectedKrxOpenDate(
  sourceTradingDate: string,
  overrides: CalendarOverrideRow[],
) {
  const fixedClosureDates =
    new Set(
      FORWARD_VERIFIED_KRX_CLOSURES_V1.map(
        (row) =>
          row.calendar_date,
      ),
    );

  const effectiveOverrides:
    CalendarOverrideRow[] = [
      ...(
        overrides ??
        []
      ).filter(
        (row) =>
          !fixedClosureDates.has(
            row.calendar_date,
          ),
      ),

      ...FORWARD_VERIFIED_KRX_CLOSURES_V1,
    ];

  return nextExpectedKrxOpenDateBase(
    sourceTradingDate,
    effectiveOverrides,
  );
}
` +
    producer.slice(
      functionEnd,
    );

  fs.writeFileSync(
    producerPath,
    producer,
    "utf8",
  );
}

let contract =
  fs.readFileSync(
    contractPath,
    "utf8",
  );

const oldFirstCheck = `  checks.nextWeekday =
    nextExpectedKrxOpenDate(
      "2026-10-08",
      [],
    ) ===
      "2026-10-09";`;

const newFirstCheck = `  checks.hangeulDaySkippedByBuiltInCalendar =
    nextExpectedKrxOpenDate(
      "2026-10-08",
      [],
    ) ===
      "2026-10-12";`;

if (
  contract.includes(
    oldFirstCheck,
  )
) {
  contract =
    contract.replace(
      oldFirstCheck,
      newFirstCheck,
    );
} else if (
  !contract.includes(
    "checks.hangeulDaySkippedByBuiltInCalendar",
  )
) {
  throw new Error(
    "EXPECTED_NEXT_WEEKDAY_CONTRACT_BLOCK_NOT_FOUND",
  );
}

/*
 * Make the capture-window examples use an actual open session
 * instead of Hangeul Day. These are only time-window fixtures.
 */
contract =
  contract.replaceAll(
    'targetSessionDate:\n        "2026-10-09",',
    'targetSessionDate:\n        "2026-10-12",',
  );

contract =
  contract.replace(
    '"2026-10-09T00:00:00.000Z",',
    '"2026-10-12T00:00:00.000Z",',
  );

contract =
  contract.replaceAll(
    'targetSessionReadyForEntryCollection(\n      "2026-10-09",',
    'targetSessionReadyForEntryCollection(\n      "2026-10-12",',
  );

contract =
  contract.replaceAll(
    '"2026-10-09T06:39:00.000Z"',
    ,
    '"2026-10-12T06:39:00.000Z"',
  );

contract =
  contract.replaceAll(
    '"2026-10-09T06:40:00.000Z"',
    ,
    '"2026-10-12T06:40:00.000Z"',
  );

/*
 * Evaluator sample dates are synthetic and not calendar-resolution
 * tests, but avoid using a known holiday as an apparent session.
 */
contract =
  contract.replace(
    '? "2026-10-09"\n            : "2026-12-10"',
    '? "2026-10-12"\n            : "2026-12-10"',
  );

fs.writeFileSync(
  contractPath,
  contract,
  "utf8",
);

const producerAfter =
  fs.readFileSync(
    producerPath,
    "utf8",
  );

const contractAfter =
  fs.readFileSync(
    contractPath,
    "utf8",
  );

const checks = {
  producerHasPatchMarker:
    producerAfter.includes(
      marker,
    ),

  builtInHangeulClosure:
    producerAfter.includes(
      '"2026-10-09"',
    ) &&
    producerAfter.includes(
      "FORWARD_VERIFIED_KRX_CLOSURES_V1",
    ),

  publicResolverStillExported:
    producerAfter.includes(
      "export function nextExpectedKrxOpenDate(",
    ),

  baseResolverPreserved:
    producerAfter.includes(
      "function nextExpectedKrxOpenDateBase(",
    ),

  contractExpectsOct12:
    contractAfter.includes(
      "checks.hangeulDaySkippedByBuiltInCalendar",
    ) &&
    contractAfter.includes(
      '"2026-10-12";',
    ),

  oldWrongContractRemoved:
    !contractAfter.includes(
      `checks.nextWeekday =
    nextExpectedKrxOpenDate(
      "2026-10-08",
      [],
    ) ===
      "2026-10-09";`,
    ),

  alphaThresholdUntouched:
    !producerAfter.includes(
      "0.66 /* calendar patch */",
    ),

  historicalCutoffUntouched:
    !producerAfter.includes(
      "2026-10-07 /* calendar patch */",
    ),
};

const nodeCheck =
  spawnSync(
    process.execPath,
    [
      "--check",
      path.resolve(
        root,
        "scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs",
      ),
    ],
    {
      cwd:
        root,
      encoding:
        "utf8",
    },
  );

checks.staticVerifierSyntaxValid =
  nodeCheck.status === 0;

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
          ? "ALPHA_V3_FORWARD_OOS_KRX_HANGEUL_DAY_V1_FIXED"
          : "ALPHA_V3_FORWARD_OOS_KRX_HANGEUL_DAY_V1_REVIEW",

      patchedFiles: [
        "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
        "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts",
      ],

      policy: {
        sourceTradingDate:
          "2026-10-08",

        closedDate:
          "2026-10-09",

        closureReason:
          "HANGEUL_DAY_PUBLIC_HOLIDAY",

        expectedTargetSessionDate:
          "2026-10-12",

        dbVerifiedOverridesStillUsed:
          true,

        weekdayFallbackStillUsedForUnknownNonWeekendDates:
          true,

        alphaThresholdChanged:
          false,

        entryPremiumCapChanged:
          false,

        historicalCutoffChanged:
          false,
      },

      checks,
      failed,

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        networkCalls:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        forwardSessionsWritten:
          0,

        schedulerChanged:
          false,

        realTradingChanged:
          false,
      },

      nextGate:
        failed.length === 0
          ? "RUN_FORWARD_OOS_CONTRACT_STATIC_AND_PRODUCER"
          : "REVIEW_CALENDAR_PATCH",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
