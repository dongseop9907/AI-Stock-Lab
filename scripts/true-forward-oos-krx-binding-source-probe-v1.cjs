const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const targets = {
  binding:
    "lib/research/run-true-forward-oos-automation-binding-v1.ts",

  producer:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",

  collector:
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",

  krxProbe:
    "scripts/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs",
};

function read(rel) {
  return fs.readFileSync(
    path.join(ROOT, rel),
    "utf8"
  );
}

function extractSignals(text) {
  const lines =
    text.split(/\r?\n/);

  const imports =
    lines.filter(line =>
      /^\s*import\b/.test(line) ||
      /^\s*const\s+.*require\(/.test(line)
    );

  const calendarLines =
    lines.filter(line =>
      /(krx|calendar|holiday|weekend|trading.?day|market.?day|session.?date|isTrading|isMarket|휴장|공휴일)/i.test(line)
    );

  const identifiers = new Set();

  for (const line of calendarLines) {
    for (const match of line.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)) {
      const id = match[0];

      if (
        /(krx|calendar|holiday|weekend|trading|market|session|business|open|close|day)/i.test(id)
      ) {
        identifiers.add(id);
      }
    }
  }

  return {
    imports: imports.slice(0, 30),
    calendarLines: calendarLines.slice(0, 60),
    identifiers: [...identifiers].slice(0, 40),
  };
}

const missing =
  Object.entries(targets)
    .filter(([, rel]) =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
    )
    .map(([key]) => key);

if (missing.length > 0) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_BINDING_SOURCE_PROBE_V1_FAILED",
    reason:
      "REQUIRED_FILES_MISSING",
    missing,
  }, null, 2));

  process.exitCode = 1;
} else {
  const result = {};

  for (const [key, rel] of Object.entries(targets)) {
    result[key] =
      extractSignals(
        read(rel)
      );
  }

  const reusableCandidates = [
    ...result.producer.identifiers,
    ...result.collector.identifiers,
    ...result.krxProbe.identifiers,
  ].filter((value, index, arr) =>
    arr.indexOf(value) === index
  );

  const report = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_BINDING_SOURCE_PROBE_V1_COMPLETE",

    reusableCandidates,

    producer: result.producer,
    collector: result.collector,
    krxProbe: result.krxProbe,

    binding: {
      identifiers:
        result.binding.identifiers,
      hasDirectCalendarGuard:
        result.binding.calendarLines.length > 0,
    },

    safety: {
      readOnly: true,
      productSourceChanges: 0,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      realTradingEnabled: false,
    },

    nextGate:
      "IMPLEMENT_BINDING_KRX_GUARD_USING_DISCOVERED_EXISTING_CALENDAR_SURFACE",
  };

  fs.mkdirSync(
    path.join(ROOT, "logs"),
    { recursive: true }
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-krx-binding-source-probe-v1.json"
    ),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(JSON.stringify({
    status:
      report.status,

    reusableCandidates:
      reusableCandidates.slice(0, 15),

    producerCalendarIdentifiers:
      result.producer.identifiers.slice(0, 12),

    collectorCalendarIdentifiers:
      result.collector.identifiers.slice(0, 12),

    krxProbeIdentifiers:
      result.krxProbe.identifiers.slice(0, 12),

    bindingHasDirectCalendarGuard:
      report.binding.hasDirectCalendarGuard,

    nextGate:
      report.nextGate,
  }, null, 2));

  process.exitCode = 0;
}
