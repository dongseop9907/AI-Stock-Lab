const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "lib/market/get-market-data-freshness-v7-7.ts";

const abs =
  path.resolve(
    root,
    rel,
  );

const canonicalRel =
  "lib/trading/krx-trading-calendar.ts";

if (!fs.existsSync(abs)) {
  throw new Error(
    "FRESHNESS_SOURCE_NOT_FOUND",
  );
}

if (
  !fs.existsSync(
    path.resolve(
      root,
      canonicalRel,
    ),
  )
) {
  throw new Error(
    "CANONICAL_KRX_CALENDAR_NOT_FOUND",
  );
}

let source =
  fs.readFileSync(
    abs,
    "utf8",
  );

function findFunctionRange(
  text,
  declarationNeedle,
) {
  const start =
    text.indexOf(
      declarationNeedle,
    );

  if (start < 0) {
    return null;
  }

  const braceStart =
    text.indexOf(
      "{",
      start,
    );

  if (braceStart < 0) {
    throw new Error(
      `OPEN_BRACE_NOT_FOUND:${declarationNeedle}`,
    );
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let i = braceStart;
    i < text.length;
    i += 1
  ) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (ch === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (
        ch === "*" &&
        next === "/"
      ) {
        blockComment = false;
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
      lineComment = true;
      i += 1;
      continue;
    }

    if (
      ch === "/" &&
      next === "*"
    ) {
      blockComment = true;
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
        return {
          start,
          braceStart,
          end: i + 1,
        };
      }
    }
  }

  throw new Error(
    `CLOSE_BRACE_NOT_FOUND:${declarationNeedle}`,
  );
}

const importMarker =
  'from "../trading/krx-trading-calendar";';

if (!source.includes(importMarker)) {
  const insertionPoint =
    source.lastIndexOf(
      "import ",
      Math.min(
        source.length,
        5000,
      ),
    );

  let importEnd = -1;

  if (insertionPoint >= 0) {
    importEnd =
      source.indexOf(
        ";\n",
        insertionPoint,
      );
  }

  if (importEnd < 0) {
    const firstImportEnd =
      source.indexOf(
        ";\n",
      );

    if (firstImportEnd < 0) {
      throw new Error(
        "IMPORT_INSERTION_POINT_NOT_FOUND",
      );
    }

    importEnd =
      firstImportEnd;
  }

  const importBlock = `

import {
  isKrxTradingDate,
  previousKrxTradingDate,
  type KrxCalendarOverrideInput,
} from "../trading/krx-trading-calendar";
`;

  source =
    source.slice(
      0,
      importEnd + 2,
    ) +
    importBlock +
    source.slice(
      importEnd + 2,
    );
}

const adapterMarker =
  "function canonicalKrxOverridesFromFreshnessMap(";

if (
  !source.includes(
    adapterMarker,
  )
) {
  const interfaceNeedle =
    "interface TradingDayOverride";

  const interfaceStart =
    source.indexOf(
      interfaceNeedle,
    );

  if (interfaceStart < 0) {
    throw new Error(
      "TRADING_DAY_OVERRIDE_INTERFACE_NOT_FOUND",
    );
  }

  const interfaceBrace =
    source.indexOf(
      "{",
      interfaceStart,
    );

  let depth = 0;
  let interfaceEnd = -1;

  for (
    let i = interfaceBrace;
    i < source.length;
    i += 1
  ) {
    if (source[i] === "{") {
      depth += 1;
    } else if (
      source[i] === "}"
    ) {
      depth -= 1;

      if (depth === 0) {
        interfaceEnd =
          i + 1;
        break;
      }
    }
  }

  if (interfaceEnd < 0) {
    throw new Error(
      "TRADING_DAY_OVERRIDE_INTERFACE_END_NOT_FOUND",
    );
  }

  const adapter = `

function canonicalKrxOverridesFromFreshnessMap(
  overrides: Map<string, TradingDayOverride>,
): KrxCalendarOverrideInput[] {
  return [
    ...overrides.entries(),
  ].map(
    ([
      date,
      override,
    ]) => ({
      date,
      isOpen:
        override.isOpen,
      verified:
        true,
      reason:
        override.reason,
      source:
        override.source,
    }),
  );
}
`;

  source =
    source.slice(
      0,
      interfaceEnd,
    ) +
    adapter +
    source.slice(
      interfaceEnd,
    );
}

function replaceFunctionBody(
  text,
  declarationNeedle,
  bodySource,
) {
  const range =
    findFunctionRange(
      text,
      declarationNeedle,
    );

  if (!range) {
    throw new Error(
      `FUNCTION_NOT_FOUND:${declarationNeedle}`,
    );
  }

  return (
    text.slice(
      0,
      range.braceStart + 1,
    ) +
    "\n" +
    bodySource +
    "\n" +
    text.slice(
      range.end - 1,
    )
  );
}

source =
  replaceFunctionBody(
    source,
    "function isTradingDay(",
    `  return isKrxTradingDate(
    sqlDate,
    canonicalKrxOverridesFromFreshnessMap(
      overrides,
    ),
  );`,
  );

source =
  replaceFunctionBody(
    source,
    "function previousTradingDay(",
    `  return previousKrxTradingDate(
    sqlDate,
    canonicalKrxOverridesFromFreshnessMap(
      overrides,
    ),
  );`,
  );

fs.writeFileSync(
  abs,
  source,
  "utf8",
);

const after =
  fs.readFileSync(
    abs,
    "utf8",
  );

const checks = {
  canonicalImportPresent:
    after.includes(
      importMarker,
    ),

  adapterPresent:
    after.includes(
      adapterMarker,
    ),

  isTradingDayDelegatesCanonical:
    after.includes(
      "return isKrxTradingDate(",
    ),

  previousTradingDayDelegatesCanonical:
    after.includes(
      "return previousKrxTradingDate(",
    ),

  weekdayMetricStillPresent:
    after.includes(
      "function weekday(",
    ) &&
    after.includes(
      "function isWeekday(",
    ),

  expectedMarketDateFlowStillPresent:
    after.includes(
      "const expectedMarketDate =",
    ) &&
    after.includes(
      "resolveExpectedMarketDate(",
    ),

  countTradingDaysFlowStillPresent:
    after.includes(
      "function countTradingDaysAfter(",
    ),

  runtimeDbOverrideLoadStillPresent:
    after.includes(
      '"market_exchange_calendar_overrides"',
    ),

  freshnessCalendarModeStillPresent:
    after.includes(
      "WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES",
    ),
};

const failed =
  Object.entries(
    checks,
  )
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
          ? "FRESHNESS_KRX_CANONICAL_CALENDAR_V1_BOUND"
          : "FRESHNESS_KRX_CANONICAL_CALENDAR_V1_REVIEW",

      modifiedFile:
        rel,

      binding: {
        isTradingDay:
          "isKrxTradingDate",

        previousTradingDay:
          "previousKrxTradingDate",

        countTradingDaysAfter:
          "PRESERVED_AND_NOW_TRANSITIVELY_CANONICAL",

        resolveExpectedMarketDate:
          "PRESERVED_AND_NOW_TRANSITIVELY_CANONICAL",

        businessWeekdayLag:
          "PRESERVED_AS_WEEKDAY_METRIC",

        runtimeDbOverrides:
          "PRESERVED",
      },

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        schedulerChanged: false,
        realTradingChanged: false,
        forwardOosStateChanged: false,
        alphaParametersChanged: false,
      },

      nextGate:
        failed.length === 0
          ? "RUN_CANONICAL_CONTRACT_FRESHNESS_TYPE_AND_LIVE_READ_SMOKE"
          : "REVIEW_FRESHNESS_CANONICAL_BINDING",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
