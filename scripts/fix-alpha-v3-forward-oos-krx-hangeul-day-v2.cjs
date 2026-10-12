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
  const braceStart = source.indexOf("{", declarationStart);

  if (braceStart < 0) {
    throw new Error("FUNCTION_OPEN_BRACE_NOT_FOUND");
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
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

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
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

  throw new Error("FUNCTION_CLOSE_BRACE_NOT_FOUND");
}

const PATCH_MARKER =
  "ALPHA_V3_FORWARD_OOS_KRX_HANGEUL_DAY_V2";

let producer = fs.readFileSync(producerPath, "utf8");

if (!producer.includes(PATCH_MARKER)) {
  const exportedDeclaration =
    "export function nextExpectedKrxOpenDate(";

  const start = producer.indexOf(exportedDeclaration);

  if (start < 0) {
    if (
      producer.includes(
        "function nextExpectedKrxOpenDateBase(",
      ) &&
      producer.includes(
        "FORWARD_VERIFIED_KRX_CLOSURES_V1",
      )
    ) {
      // A prior patch already transformed the function.
    } else {
      throw new Error(
        "NEXT_EXPECTED_KRX_OPEN_DATE_EXPORT_NOT_FOUND",
      );
    }
  } else {
    const end = findFunctionEnd(producer, start);

    const originalFunction = producer
      .slice(start, end)
      .replace(
        exportedDeclaration,
        "function nextExpectedKrxOpenDateBase(",
      );

    const wrapper = `

/*
 * ${PATCH_MARKER}
 *
 * 2026-10-09 is Hangeul Day and is not a KRX trading session.
 * Preserve DB verified overrides, but make this already-known
 * closure fail-safe even if the DB row is absent.
 *
 * Alpha score, Entry V3 threshold, premium cap, historical cutoff,
 * and future return evaluation are intentionally untouched.
 */
const FORWARD_VERIFIED_KRX_CLOSURES_V1:
  CalendarOverrideRow[] = [
    {
      calendar_date: "2026-10-09",
      is_open: false,
      verified: true,
    },
  ];

export function nextExpectedKrxOpenDate(
  sourceTradingDate: string,
  overrides: CalendarOverrideRow[],
) {
  const builtInDates = new Set(
    FORWARD_VERIFIED_KRX_CLOSURES_V1.map(
      (row) => row.calendar_date,
    ),
  );

  const effectiveOverrides: CalendarOverrideRow[] = [
    ...(overrides ?? []).filter(
      (row) => !builtInDates.has(row.calendar_date),
    ),
    ...FORWARD_VERIFIED_KRX_CLOSURES_V1,
  ];

  return nextExpectedKrxOpenDateBase(
    sourceTradingDate,
    effectiveOverrides,
  );
}
`;

    producer =
      producer.slice(0, start) +
      originalFunction +
      wrapper +
      producer.slice(end);

    fs.writeFileSync(producerPath, producer, "utf8");
  }
}

let contract = fs.readFileSync(contractPath, "utf8");

const oldCheck = [
  "  checks.nextWeekday =",
  "    nextExpectedKrxOpenDate(",
  '      "2026-10-08",',
  "      [],",
  "    ) ===",
  '      "2026-10-09";',
].join("\n");

const newCheck = [
  "  checks.hangeulDaySkippedByBuiltInCalendar =",
  "    nextExpectedKrxOpenDate(",
  '      "2026-10-08",',
  "      [],",
  "    ) ===",
  '      "2026-10-12";',
].join("\n");

if (contract.includes(oldCheck)) {
  contract = contract.replace(oldCheck, newCheck);
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
 * Capture-window fixtures should use an actual open session.
 * The verifiedClosureSkipped fixture intentionally keeps 10/09.
 */
contract = contract.replaceAll(
  'targetSessionDate:\n        "2026-10-09",',
  'targetSessionDate:\n        "2026-10-12",',
);

contract = contract.replaceAll(
  '"2026-10-09T00:00:00.000Z"',
  '"2026-10-12T00:00:00.000Z"',
);

contract = contract.replaceAll(
  'targetSessionReadyForEntryCollection(\n      "2026-10-09",',
  'targetSessionReadyForEntryCollection(\n      "2026-10-12",',
);

contract = contract.replaceAll(
  '"2026-10-09T06:39:00.000Z"',
  '"2026-10-12T06:39:00.000Z"',
);

contract = contract.replaceAll(
  '"2026-10-09T06:40:00.000Z"',
  '"2026-10-12T06:40:00.000Z"',
);

contract = contract.replace(
  '? "2026-10-09"\n            : "2026-12-10"',
  '? "2026-10-12"\n            : "2026-12-10"',
);

fs.writeFileSync(contractPath, contract, "utf8");

const producerAfter =
  fs.readFileSync(producerPath, "utf8");

const contractAfter =
  fs.readFileSync(contractPath, "utf8");

const checks = {
  patchMarkerPresent:
    producerAfter.includes(PATCH_MARKER),

  builtInClosurePresent:
    producerAfter.includes(
      'calendar_date: "2026-10-09"',
    ) &&
    producerAfter.includes(
      "FORWARD_VERIFIED_KRX_CLOSURES_V1",
    ),

  exportedResolverPresent:
    producerAfter.includes(
      "export function nextExpectedKrxOpenDate(",
    ),

  baseResolverPresent:
    producerAfter.includes(
      "function nextExpectedKrxOpenDateBase(",
    ),

  contractNowExpectsOct12:
    contractAfter.includes(
      "checks.hangeulDaySkippedByBuiltInCalendar",
    ) &&
    contractAfter.includes(
      '      "2026-10-12";',
    ),

  oldWrongExpectationGone:
    !contractAfter.includes(oldCheck),
};

const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_FORWARD_OOS_KRX_HANGEUL_DAY_V2_FIXED"
          : "ALPHA_V3_FORWARD_OOS_KRX_HANGEUL_DAY_V2_REVIEW",

      patchedFiles: [
        "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
        "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts",
      ],

      policy: {
        sourceTradingDate: "2026-10-08",
        closedDate: "2026-10-09",
        expectedTargetSessionDate: "2026-10-12",
        alphaThresholdChanged: false,
        entryPremiumCapChanged: false,
        historicalCutoffChanged: false,
      },

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        forwardSessionsWritten: 0,
        schedulerChanged: false,
        realTradingChanged: false,
      },

      nextGate:
        failed.length === 0
          ? "RUN_CONTRACT_STATIC_AND_PRODUCER"
          : "REVIEW_FORWARD_CALENDAR_PATCH",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
