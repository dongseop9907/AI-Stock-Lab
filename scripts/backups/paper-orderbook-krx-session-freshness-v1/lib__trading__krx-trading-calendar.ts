export const KRX_TRADING_CALENDAR_VERSION =
  "KRX_CANONICAL_TRADING_CALENDAR_V1" as const;

export const KRX_TIME_ZONE =
  "Asia/Seoul" as const;

export type KrxCalendarOverrideInput = {
  date?: string | null;
  calendar_date?: string | null;

  isOpen?: boolean | null;
  is_open?: boolean | null;

  verified?: boolean | null;

  reason?: string | null;
  source?: string | null;
};

export type KrxCalendarOverride = {
  date: string;
  isOpen: boolean;
  verified: true;
  reason: string | null;
  source: string;
};

export type ExpectedKrxMarketDateInput = {
  now: Date;
  overrides?: KrxCalendarOverrideInput[];
  marketDataReadyAfter?: {
    hour: number;
    minute: number;
  };
};

const SQL_DATE_RE =
  /^\d{4}-\d{2}-\d{2}$/;

const BUILT_IN_VERIFIED_KRX_OVERRIDES: readonly KrxCalendarOverride[] = [
  {
    date: "2026-08-17",
    isOpen: false,
    verified: true,
    reason: "2026 substitute public holiday closure.",
    source: "BUILT_IN_VERIFIED_KRX_CALENDAR",
  },
  {
    date: "2026-09-24",
    isOpen: false,
    verified: true,
    reason: "2026 Chuseok public-holiday closure.",
    source: "BUILT_IN_VERIFIED_KRX_CALENDAR",
  },
  {
    date: "2026-09-25",
    isOpen: false,
    verified: true,
    reason: "2026 Chuseok public-holiday closure.",
    source: "BUILT_IN_VERIFIED_KRX_CALENDAR",
  },
  {
    date: "2026-10-05",
    isOpen: false,
    verified: true,
    reason: "2026 substitute public holiday closure associated with National Foundation Day.",
    source: "BUILT_IN_VERIFIED_KRX_CALENDAR",
  },
  {
    date: "2026-10-09",
    isOpen: false,
    verified: true,
    reason: "2026 Hangeul Day public-holiday closure.",
    source: "BUILT_IN_VERIFIED_KRX_CALENDAR",
  },
];

function assertSqlDate(
  value: string,
): string {
  if (!SQL_DATE_RE.test(value)) {
    throw new Error(
      `INVALID_KRX_SQL_DATE:${value}`,
    );
  }

  const parsed =
    new Date(
      `${value}T00:00:00.000Z`,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    ) ||
    parsed
      .toISOString()
      .slice(0, 10) !==
      value
  ) {
    throw new Error(
      `INVALID_KRX_SQL_DATE:${value}`,
    );
  }

  return value;
}

function normalizeOverride(
  row: KrxCalendarOverrideInput,
): KrxCalendarOverride | null {
  if (
    !row ||
    row.verified !== true
  ) {
    return null;
  }

  const date =
    row.date ??
    row.calendar_date ??
    null;

  const isOpen =
    typeof row.isOpen === "boolean"
      ? row.isOpen
      : typeof row.is_open === "boolean"
        ? row.is_open
        : null;

  if (
    !date ||
    typeof isOpen !== "boolean"
  ) {
    return null;
  }

  assertSqlDate(date);

  return {
    date,
    isOpen,
    verified: true,
    reason:
      row.reason ??
      null,
    source:
      row.source ??
      "RUNTIME_VERIFIED_KRX_CALENDAR",
  };
}

function shiftSqlDate(
  date: string,
  days: number,
): string {
  assertSqlDate(date);

  const cursor =
    new Date(
      `${date}T00:00:00.000Z`,
    );

  cursor.setUTCDate(
    cursor.getUTCDate() +
      days,
  );

  return cursor
    .toISOString()
    .slice(0, 10);
}

function utcWeekday(
  date: string,
): number {
  assertSqlDate(date);

  return new Date(
    `${date}T00:00:00.000Z`,
  ).getUTCDay();
}

function kstClock(
  now: Date,
): {
  date: string;
  hour: number;
  minute: number;
} {
  if (
    !(now instanceof Date) ||
    Number.isNaN(
      now.getTime(),
    )
  ) {
    throw new Error(
      "INVALID_KRX_CLOCK",
    );
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          KRX_TIME_ZONE,
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
        hour:
          "2-digit",
        minute:
          "2-digit",
        hourCycle:
          "h23",
      },
    ).formatToParts(
      now,
    );

  const values =
    new Map(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  const year =
    values.get(
      "year",
    );
  const month =
    values.get(
      "month",
    );
  const day =
    values.get(
      "day",
    );
  const hour =
    Number(
      values.get(
        "hour",
      ),
    );
  const minute =
    Number(
      values.get(
        "minute",
      ),
    );

  if (
    !year ||
    !month ||
    !day ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    throw new Error(
      "KRX_CLOCK_PARTS_UNAVAILABLE",
    );
  }

  return {
    date:
      `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

export function getBuiltInVerifiedKrxOverrides():
  readonly KrxCalendarOverride[] {
  return BUILT_IN_VERIFIED_KRX_OVERRIDES;
}

export function mergeVerifiedKrxOverrides(
  runtimeOverrides:
    KrxCalendarOverrideInput[] =
      [],
): KrxCalendarOverride[] {
  const byDate =
    new Map<
      string,
      KrxCalendarOverride
    >();

  /*
   * Runtime verified rows override the weekday/weekend baseline.
   * They are loaded first.
   */
  for (
    const input of
    runtimeOverrides
  ) {
    const normalized =
      normalizeOverride(
        input,
      );

    if (!normalized) {
      continue;
    }

    byDate.set(
      normalized.date,
      normalized,
    );
  }

  /*
   * Built-in verified facts win on conflicts.
   * This prevents an accidental runtime "open" row from reopening
   * a known immutable public-holiday closure such as 2026-10-09.
   */
  for (
    const fixed of
    BUILT_IN_VERIFIED_KRX_OVERRIDES
  ) {
    byDate.set(
      fixed.date,
      fixed,
    );
  }

  return [
    ...byDate.values(),
  ].sort(
    (a, b) =>
      a.date.localeCompare(
        b.date,
      ),
  );
}

export function isKrxTradingDate(
  date: string,
  runtimeOverrides:
    KrxCalendarOverrideInput[] =
      [],
): boolean {
  assertSqlDate(date);

  const override =
    mergeVerifiedKrxOverrides(
      runtimeOverrides,
    ).find(
      (row) =>
        row.date ===
        date,
    );

  if (override) {
    return override.isOpen;
  }

  const weekday =
    utcWeekday(
      date,
    );

  return (
    weekday !== 0 &&
    weekday !== 6
  );
}

export function nextKrxTradingDate(
  afterDate: string,
  runtimeOverrides:
    KrxCalendarOverrideInput[] =
      [],
): string {
  assertSqlDate(
    afterDate,
  );

  let cursor =
    afterDate;

  for (
    let i = 0;
    i < 370;
    i += 1
  ) {
    cursor =
      shiftSqlDate(
        cursor,
        1,
      );

    if (
      isKrxTradingDate(
        cursor,
        runtimeOverrides,
      )
    ) {
      return cursor;
    }
  }

  throw new Error(
    `NEXT_KRX_TRADING_DATE_NOT_FOUND:${afterDate}`,
  );
}

export function previousKrxTradingDate(
  beforeDate: string,
  runtimeOverrides:
    KrxCalendarOverrideInput[] =
      [],
): string {
  assertSqlDate(
    beforeDate,
  );

  let cursor =
    beforeDate;

  for (
    let i = 0;
    i < 370;
    i += 1
  ) {
    cursor =
      shiftSqlDate(
        cursor,
        -1,
      );

    if (
      isKrxTradingDate(
        cursor,
        runtimeOverrides,
      )
    ) {
      return cursor;
    }
  }

  throw new Error(
    `PREVIOUS_KRX_TRADING_DATE_NOT_FOUND:${beforeDate}`,
  );
}

export function resolveExpectedKrxMarketDate(
  input:
    ExpectedKrxMarketDateInput,
): string {
  const {
    now,
    overrides = [],
    marketDataReadyAfter = {
      hour: 16,
      minute: 30,
    },
  } = input;

  const clock =
    kstClock(
      now,
    );

  const ready =
    clock.hour >
      marketDataReadyAfter.hour ||
    (
      clock.hour ===
        marketDataReadyAfter.hour &&
      clock.minute >=
        marketDataReadyAfter.minute
    );

  if (
    isKrxTradingDate(
      clock.date,
      overrides,
    ) &&
    ready
  ) {
    return clock.date;
  }

  return previousKrxTradingDate(
    clock.date,
    overrides,
  );
}
