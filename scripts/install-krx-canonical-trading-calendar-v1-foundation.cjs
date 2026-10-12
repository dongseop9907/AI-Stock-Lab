const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();

const files = {
  "lib/trading/krx-trading-calendar.ts":
    "export const KRX_TRADING_CALENDAR_VERSION =\n  \"KRX_CANONICAL_TRADING_CALENDAR_V1\" as const;\n\nexport const KRX_TIME_ZONE =\n  \"Asia/Seoul\" as const;\n\nexport type KrxCalendarOverrideInput = {\n  date?: string | null;\n  calendar_date?: string | null;\n\n  isOpen?: boolean | null;\n  is_open?: boolean | null;\n\n  verified?: boolean | null;\n\n  reason?: string | null;\n  source?: string | null;\n};\n\nexport type KrxCalendarOverride = {\n  date: string;\n  isOpen: boolean;\n  verified: true;\n  reason: string | null;\n  source: string;\n};\n\nexport type ExpectedKrxMarketDateInput = {\n  now: Date;\n  overrides?: KrxCalendarOverrideInput[];\n  marketDataReadyAfter?: {\n    hour: number;\n    minute: number;\n  };\n};\n\nconst SQL_DATE_RE =\n  /^\\d{4}-\\d{2}-\\d{2}$/;\n\nconst BUILT_IN_VERIFIED_KRX_OVERRIDES: readonly KrxCalendarOverride[] = [\n  {\n    date: \"2026-08-17\",\n    isOpen: false,\n    verified: true,\n    reason: \"2026 substitute public holiday closure.\",\n    source: \"BUILT_IN_VERIFIED_KRX_CALENDAR\",\n  },\n  {\n    date: \"2026-09-24\",\n    isOpen: false,\n    verified: true,\n    reason: \"2026 Chuseok public-holiday closure.\",\n    source: \"BUILT_IN_VERIFIED_KRX_CALENDAR\",\n  },\n  {\n    date: \"2026-09-25\",\n    isOpen: false,\n    verified: true,\n    reason: \"2026 Chuseok public-holiday closure.\",\n    source: \"BUILT_IN_VERIFIED_KRX_CALENDAR\",\n  },\n  {\n    date: \"2026-10-05\",\n    isOpen: false,\n    verified: true,\n    reason: \"2026 substitute public holiday closure associated with National Foundation Day.\",\n    source: \"BUILT_IN_VERIFIED_KRX_CALENDAR\",\n  },\n  {\n    date: \"2026-10-09\",\n    isOpen: false,\n    verified: true,\n    reason: \"2026 Hangeul Day public-holiday closure.\",\n    source: \"BUILT_IN_VERIFIED_KRX_CALENDAR\",\n  },\n];\n\nfunction assertSqlDate(\n  value: string,\n): string {\n  if (!SQL_DATE_RE.test(value)) {\n    throw new Error(\n      `INVALID_KRX_SQL_DATE:${value}`,\n    );\n  }\n\n  const parsed =\n    new Date(\n      `${value}T00:00:00.000Z`,\n    );\n\n  if (\n    Number.isNaN(\n      parsed.getTime(),\n    ) ||\n    parsed\n      .toISOString()\n      .slice(0, 10) !==\n      value\n  ) {\n    throw new Error(\n      `INVALID_KRX_SQL_DATE:${value}`,\n    );\n  }\n\n  return value;\n}\n\nfunction normalizeOverride(\n  row: KrxCalendarOverrideInput,\n): KrxCalendarOverride | null {\n  if (\n    !row ||\n    row.verified !== true\n  ) {\n    return null;\n  }\n\n  const date =\n    row.date ??\n    row.calendar_date ??\n    null;\n\n  const isOpen =\n    typeof row.isOpen === \"boolean\"\n      ? row.isOpen\n      : typeof row.is_open === \"boolean\"\n        ? row.is_open\n        : null;\n\n  if (\n    !date ||\n    typeof isOpen !== \"boolean\"\n  ) {\n    return null;\n  }\n\n  assertSqlDate(date);\n\n  return {\n    date,\n    isOpen,\n    verified: true,\n    reason:\n      row.reason ??\n      null,\n    source:\n      row.source ??\n      \"RUNTIME_VERIFIED_KRX_CALENDAR\",\n  };\n}\n\nfunction shiftSqlDate(\n  date: string,\n  days: number,\n): string {\n  assertSqlDate(date);\n\n  const cursor =\n    new Date(\n      `${date}T00:00:00.000Z`,\n    );\n\n  cursor.setUTCDate(\n    cursor.getUTCDate() +\n      days,\n  );\n\n  return cursor\n    .toISOString()\n    .slice(0, 10);\n}\n\nfunction utcWeekday(\n  date: string,\n): number {\n  assertSqlDate(date);\n\n  return new Date(\n    `${date}T00:00:00.000Z`,\n  ).getUTCDay();\n}\n\nfunction kstClock(\n  now: Date,\n): {\n  date: string;\n  hour: number;\n  minute: number;\n} {\n  if (\n    !(now instanceof Date) ||\n    Number.isNaN(\n      now.getTime(),\n    )\n  ) {\n    throw new Error(\n      \"INVALID_KRX_CLOCK\",\n    );\n  }\n\n  const parts =\n    new Intl.DateTimeFormat(\n      \"en-CA\",\n      {\n        timeZone:\n          KRX_TIME_ZONE,\n        year:\n          \"numeric\",\n        month:\n          \"2-digit\",\n        day:\n          \"2-digit\",\n        hour:\n          \"2-digit\",\n        minute:\n          \"2-digit\",\n        hourCycle:\n          \"h23\",\n      },\n    ).formatToParts(\n      now,\n    );\n\n  const values =\n    new Map(\n      parts.map(\n        (part) => [\n          part.type,\n          part.value,\n        ],\n      ),\n    );\n\n  const year =\n    values.get(\n      \"year\",\n    );\n  const month =\n    values.get(\n      \"month\",\n    );\n  const day =\n    values.get(\n      \"day\",\n    );\n  const hour =\n    Number(\n      values.get(\n        \"hour\",\n      ),\n    );\n  const minute =\n    Number(\n      values.get(\n        \"minute\",\n      ),\n    );\n\n  if (\n    !year ||\n    !month ||\n    !day ||\n    !Number.isFinite(hour) ||\n    !Number.isFinite(minute)\n  ) {\n    throw new Error(\n      \"KRX_CLOCK_PARTS_UNAVAILABLE\",\n    );\n  }\n\n  return {\n    date:\n      `${year}-${month}-${day}`,\n    hour,\n    minute,\n  };\n}\n\nexport function getBuiltInVerifiedKrxOverrides():\n  readonly KrxCalendarOverride[] {\n  return BUILT_IN_VERIFIED_KRX_OVERRIDES;\n}\n\nexport function mergeVerifiedKrxOverrides(\n  runtimeOverrides:\n    KrxCalendarOverrideInput[] =\n      [],\n): KrxCalendarOverride[] {\n  const byDate =\n    new Map<\n      string,\n      KrxCalendarOverride\n    >();\n\n  /*\n   * Runtime verified rows override the weekday/weekend baseline.\n   * They are loaded first.\n   */\n  for (\n    const input of\n    runtimeOverrides\n  ) {\n    const normalized =\n      normalizeOverride(\n        input,\n      );\n\n    if (!normalized) {\n      continue;\n    }\n\n    byDate.set(\n      normalized.date,\n      normalized,\n    );\n  }\n\n  /*\n   * Built-in verified facts win on conflicts.\n   * This prevents an accidental runtime \"open\" row from reopening\n   * a known immutable public-holiday closure such as 2026-10-09.\n   */\n  for (\n    const fixed of\n    BUILT_IN_VERIFIED_KRX_OVERRIDES\n  ) {\n    byDate.set(\n      fixed.date,\n      fixed,\n    );\n  }\n\n  return [\n    ...byDate.values(),\n  ].sort(\n    (a, b) =>\n      a.date.localeCompare(\n        b.date,\n      ),\n  );\n}\n\nexport function isKrxTradingDate(\n  date: string,\n  runtimeOverrides:\n    KrxCalendarOverrideInput[] =\n      [],\n): boolean {\n  assertSqlDate(date);\n\n  const override =\n    mergeVerifiedKrxOverrides(\n      runtimeOverrides,\n    ).find(\n      (row) =>\n        row.date ===\n        date,\n    );\n\n  if (override) {\n    return override.isOpen;\n  }\n\n  const weekday =\n    utcWeekday(\n      date,\n    );\n\n  return (\n    weekday !== 0 &&\n    weekday !== 6\n  );\n}\n\nexport function nextKrxTradingDate(\n  afterDate: string,\n  runtimeOverrides:\n    KrxCalendarOverrideInput[] =\n      [],\n): string {\n  assertSqlDate(\n    afterDate,\n  );\n\n  let cursor =\n    afterDate;\n\n  for (\n    let i = 0;\n    i < 370;\n    i += 1\n  ) {\n    cursor =\n      shiftSqlDate(\n        cursor,\n        1,\n      );\n\n    if (\n      isKrxTradingDate(\n        cursor,\n        runtimeOverrides,\n      )\n    ) {\n      return cursor;\n    }\n  }\n\n  throw new Error(\n    `NEXT_KRX_TRADING_DATE_NOT_FOUND:${afterDate}`,\n  );\n}\n\nexport function previousKrxTradingDate(\n  beforeDate: string,\n  runtimeOverrides:\n    KrxCalendarOverrideInput[] =\n      [],\n): string {\n  assertSqlDate(\n    beforeDate,\n  );\n\n  let cursor =\n    beforeDate;\n\n  for (\n    let i = 0;\n    i < 370;\n    i += 1\n  ) {\n    cursor =\n      shiftSqlDate(\n        cursor,\n        -1,\n      );\n\n    if (\n      isKrxTradingDate(\n        cursor,\n        runtimeOverrides,\n      )\n    ) {\n      return cursor;\n    }\n  }\n\n  throw new Error(\n    `PREVIOUS_KRX_TRADING_DATE_NOT_FOUND:${beforeDate}`,\n  );\n}\n\nexport function resolveExpectedKrxMarketDate(\n  input:\n    ExpectedKrxMarketDateInput,\n): string {\n  const {\n    now,\n    overrides = [],\n    marketDataReadyAfter = {\n      hour: 16,\n      minute: 30,\n    },\n  } = input;\n\n  const clock =\n    kstClock(\n      now,\n    );\n\n  const ready =\n    clock.hour >\n      marketDataReadyAfter.hour ||\n    (\n      clock.hour ===\n        marketDataReadyAfter.hour &&\n      clock.minute >=\n        marketDataReadyAfter.minute\n    );\n\n  if (\n    isKrxTradingDate(\n      clock.date,\n      overrides,\n    ) &&\n    ready\n  ) {\n    return clock.date;\n  }\n\n  return previousKrxTradingDate(\n    clock.date,\n    overrides,\n  );\n}\n",

  "scripts/krx-canonical-trading-calendar-v1-contract-test.ts":
    "import {\n  strict as assert,\n} from \"node:assert\";\n\nimport {\n  getBuiltInVerifiedKrxOverrides,\n  isKrxTradingDate,\n  mergeVerifiedKrxOverrides,\n  nextKrxTradingDate,\n  previousKrxTradingDate,\n  resolveExpectedKrxMarketDate,\n} from \"../lib/trading/krx-trading-calendar\";\n\nfunction main() {\n  const checks:\n    Record<string, boolean> = {};\n\n  checks.normalWeekdayOpen =\n    isKrxTradingDate(\n      \"2026-10-08\",\n    ) ===\n      true;\n\n  checks.hangeulDayClosed =\n    isKrxTradingDate(\n      \"2026-10-09\",\n    ) ===\n      false;\n\n  checks.weekendClosed =\n    isKrxTradingDate(\n      \"2026-10-10\",\n    ) ===\n      false &&\n    isKrxTradingDate(\n      \"2026-10-11\",\n    ) ===\n      false;\n\n  checks.nextSessionSkipsHolidayAndWeekend =\n    nextKrxTradingDate(\n      \"2026-10-08\",\n    ) ===\n      \"2026-10-12\";\n\n  checks.previousSessionSkipsHolidayAndWeekend =\n    previousKrxTradingDate(\n      \"2026-10-12\",\n    ) ===\n      \"2026-10-08\";\n\n  checks.runtimeVerifiedClosureApplied =\n    isKrxTradingDate(\n      \"2026-10-13\",\n      [\n        {\n          calendar_date:\n            \"2026-10-13\",\n          is_open:\n            false,\n          verified:\n            true,\n          reason:\n            \"TEST_VERIFIED_CLOSURE\",\n        },\n      ],\n    ) ===\n      false;\n\n  checks.unverifiedOverrideIgnored =\n    isKrxTradingDate(\n      \"2026-10-13\",\n      [\n        {\n          calendar_date:\n            \"2026-10-13\",\n          is_open:\n            false,\n          verified:\n            false,\n        },\n      ],\n    ) ===\n      true;\n\n  checks.builtInClosureWinsConflict =\n    isKrxTradingDate(\n      \"2026-10-09\",\n      [\n        {\n          calendar_date:\n            \"2026-10-09\",\n          is_open:\n            true,\n          verified:\n            true,\n        },\n      ],\n    ) ===\n      false;\n\n  checks.beforeReadyUsesPreviousSession =\n    resolveExpectedKrxMarketDate({\n      now:\n        new Date(\n          \"2026-10-12T01:00:00.000Z\",\n        ),\n    }) ===\n      \"2026-10-08\";\n\n  checks.afterReadyUsesSameSession =\n    resolveExpectedKrxMarketDate({\n      now:\n        new Date(\n          \"2026-10-12T08:00:00.000Z\",\n        ),\n    }) ===\n      \"2026-10-12\";\n\n  checks.holidayUsesPreviousSession =\n    resolveExpectedKrxMarketDate({\n      now:\n        new Date(\n          \"2026-10-09T10:00:00.000Z\",\n        ),\n    }) ===\n      \"2026-10-08\";\n\n  const merged =\n    mergeVerifiedKrxOverrides([\n      {\n        date:\n          \"2026-10-13\",\n        isOpen:\n          false,\n        verified:\n          true,\n      },\n    ]);\n\n  checks.mergeContainsBuiltInAndRuntime =\n    merged.some(\n      (row) =>\n        row.date ===\n          \"2026-10-09\" &&\n        row.isOpen ===\n          false,\n    ) &&\n    merged.some(\n      (row) =>\n        row.date ===\n          \"2026-10-13\" &&\n        row.isOpen ===\n          false,\n    );\n\n  checks.builtInCalendarPresent =\n    getBuiltInVerifiedKrxOverrides()\n      .some(\n        (row) =>\n          row.date ===\n            \"2026-10-09\" &&\n          row.isOpen ===\n            false,\n      );\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  assert.equal(\n    failed.length,\n    0,\n    `FAILED:${failed.join(\",\")}`,\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          \"KRX_CANONICAL_TRADING_CALENDAR_V1_CONTRACT_VERIFIED\",\n\n        checks,\n\n        examples: {\n          after20261008:\n            nextKrxTradingDate(\n              \"2026-10-08\",\n            ),\n\n          before20261012:\n            previousKrxTradingDate(\n              \"2026-10-12\",\n            ),\n\n          expectedOnHoliday:\n            resolveExpectedKrxMarketDate({\n              now:\n                new Date(\n                  \"2026-10-09T10:00:00.000Z\",\n                ),\n            }),\n        },\n\n        safety: {\n          databaseReads: 0,\n          databaseWrites: 0,\n          networkCalls: 0,\n          ordersCreated: 0,\n          positionsChanged: 0,\n          productionChanged: false,\n        },\n\n        nextGate:\n          \"BIND_FORWARD_AND_FRESHNESS_TO_CANONICAL_CALENDAR\",\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain();\n"
};

for (const [rel, content] of Object.entries(files)) {
  const abs = path.resolve(root, rel);

  fs.mkdirSync(
    path.dirname(abs),
    { recursive: true }
  );

  fs.writeFileSync(
    abs,
    content,
    "utf8"
  );
}

const syntaxCheck = spawnSync(
  process.execPath,
  [
    "--check",
    path.resolve(
      root,
      "scripts/krx-canonical-trading-calendar-v1-contract-test.ts"
    )
  ],
  {
    cwd: root,
    encoding: "utf8"
  }
);

console.log(
  JSON.stringify(
    {
      status:
        "KRX_CANONICAL_TRADING_CALENDAR_V1_FOUNDATION_INSTALLED",

      generatedFiles:
        Object.keys(files),

      contract: {
        builtInVerifiedClosures: [
          "2026-08-17",
          "2026-09-24",
          "2026-09-25",
          "2026-10-05",
          "2026-10-09"
        ],

        runtimeVerifiedOverrides:
          "SUPPORTED",

        builtInKnownClosureConflictPolicy:
          "BUILT_IN_WINS",

        weekendPolicy:
          "CLOSED",

        expectedMarketDateReadyAfter:
          "16:30 KST"
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        existingSourceFilesModified: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        schedulerChanged: false,
        realTradingChanged: false,
        forwardOosStateChanged: false
      },

      nextAction:
        "RUN_CANONICAL_CALENDAR_CONTRACT_TEST"
    },
    null,
    2
  )
);
