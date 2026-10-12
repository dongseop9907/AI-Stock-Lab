const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const calendarRel =
  "lib/trading/krx-trading-calendar.ts";

const producerRel =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";

function read(rel) {
  return fs.readFileSync(
    path.join(ROOT, rel),
    "utf8"
  );
}

function extractAround(text, pattern, before = 8, after = 28) {
  const lines =
    text.split(/\r?\n/);

  const idx =
    lines.findIndex(
      line =>
        pattern.test(line)
    );

  if (idx < 0) {
    return [];
  }

  const start =
    Math.max(
      0,
      idx - before
    );

  const end =
    Math.min(
      lines.length,
      idx + after + 1
    );

  return lines
    .slice(start, end)
    .map(
      (line, offset) => ({
        line:
          start + offset + 1,
        text:
          line
      })
    );
}

const required = [
  calendarRel,
  producerRel,
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(
          ROOT,
          rel
        )
      )
  );

if (missing.length > 0) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_API_CONTRACT_PROBE_V1_FAILED",
    reason:
      "REQUIRED_FILES_MISSING",
    missing,
  }, null, 2));

  process.exitCode = 1;
} else {
  const calendar =
    read(calendarRel);

  const producer =
    read(producerRel);

  const exportNames =
    [...calendar.matchAll(
      /export\s+(?:async\s+)?(?:function|const|let|class|type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
    )]
      .map(match => match[1])
      .filter(
        (value, index, arr) =>
          arr.indexOf(value) === index
      );

  const isTradingDateDefinition =
    extractAround(
      calendar,
      /export\s+function\s+isKrxTradingDate\s*\(/
    );

  const nextTradingDateDefinition =
    extractAround(
      calendar,
      /export\s+function\s+nextKrxTradingDate\s*\(/
    );

  const mergeOverridesDefinition =
    extractAround(
      calendar,
      /export\s+function\s+mergeVerifiedKrxOverrides\s*\(/
    );

  const producerImport =
    extractAround(
      producer,
      /from\s+["'][^"']*krx-trading-calendar["']/
    );

  const producerRuntimeOverride =
    extractAround(
      producer,
      /market_exchange_calendar_overrides/
    );

  const producerNextDateCall =
    extractAround(
      producer,
      /nextKrxTradingDate\s*\(/
    );

  const compact = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_API_CONTRACT_PROBE_V1_COMPLETE",

    exportNames,

    isKrxTradingDateSignature:
      isTradingDateDefinition.slice(0, 12),

    nextKrxTradingDateSignature:
      nextTradingDateDefinition.slice(0, 12),

    mergeVerifiedKrxOverridesSignature:
      mergeOverridesDefinition.slice(0, 12),

    producerCalendarImport:
      producerImport.slice(0, 12),

    producerRuntimeOverrideUsage:
      producerRuntimeOverride.slice(0, 18),

    producerNextKrxTradingDateUsage:
      producerNextDateCall.slice(0, 18),

    safety: {
      readOnly:
        true,
      filesModified:
        0,
      databaseReads:
        0,
      databaseWrites:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      realTradingEnabled:
        false,
    },

    nextGate:
      "PATCH_AUTOMATION_BINDING_TO_CANONICAL_KRX_CALENDAR_V1",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs"
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-krx-api-contract-probe-v1.json"
    ),
    JSON.stringify(
      compact,
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({
    status:
      compact.status,

    exportNames:
      compact.exportNames,

    isKrxTradingDateSignature:
      compact.isKrxTradingDateSignature,

    mergeVerifiedKrxOverridesSignature:
      compact.mergeVerifiedKrxOverridesSignature,

    producerCalendarImport:
      compact.producerCalendarImport,

    producerRuntimeOverrideUsage:
      compact.producerRuntimeOverrideUsage,

    producerNextKrxTradingDateUsage:
      compact.producerNextKrxTradingDateUsage,

    nextGate:
      compact.nextGate,
  }, null, 2));

  process.exitCode = 0;
}
