const fs = require("fs");
const path = require("path");

const root = process.cwd();

const reportFile = path.resolve(
  root,
  "logs/alpha-v3-automation-interval-expression-probe.json"
);

const targets = [
  "app/components/AutomationRunPanel.tsx",
  "app/page.tsx",
  "app/api/trading/automation/run/route.ts",
  "app/components/TradingMaintenanceButton.tsx",
];

function read(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    return {
      file: rel,
      exists: false,
      text: null,
    };
  }

  return {
    file: rel,
    exists: true,
    text: fs.readFileSync(file, "utf8"),
  };
}

function lineNo(text, index) {
  return text
    .slice(0, index)
    .split(/\r?\n/)
    .length;
}

function snippet(text, index, radius = 12) {
  const normalized =
    text.replace(/\r\n/g, "\n");

  const lines =
    normalized.split("\n");

  const line =
    lineNo(normalized, index);

  const start =
    Math.max(1, line - radius);

  const end =
    Math.min(lines.length, line + radius);

  return {
    line,
    snippet:
      lines
        .slice(start - 1, end)
        .map(
          (value, offset) =>
            `${start + offset}: ${value}`
        )
        .join("\n"),
  };
}

function extractBalancedCall(text, startIndex, functionName) {
  const callStart =
    text.indexOf(
      functionName,
      startIndex
    );

  if (callStart < 0) {
    return null;
  }

  const openParen =
    text.indexOf(
      "(",
      callStart + functionName.length
    );

  if (openParen < 0) {
    return null;
  }

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (
    let i = openParen;
    i < text.length;
    i += 1
  ) {
    const ch = text[i];

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
      ch === "'" ||
      ch === '"' ||
      ch === "`"
    ) {
      quote = ch;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      continue;
    }

    if (ch === ")") {
      depth -= 1;

      if (depth === 0) {
        return {
          start:
            callStart,

          end:
            i + 1,

          text:
            text.slice(
              callStart,
              i + 1
            ),

          argsText:
            text.slice(
              openParen + 1,
              i
            ),
        };
      }
    }
  }

  return null;
}

function splitTopLevelArgs(argsText) {
  const args = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote = null;
  let escaped = false;

  for (
    let i = 0;
    i < argsText.length;
    i += 1
  ) {
    const ch = argsText[i];

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
      ch === "'" ||
      ch === '"' ||
      ch === "`"
    ) {
      quote = ch;
      continue;
    }

    if (ch === "(") paren += 1;
    if (ch === ")") paren -= 1;
    if (ch === "{") brace += 1;
    if (ch === "}") brace -= 1;
    if (ch === "[") bracket += 1;
    if (ch === "]") bracket -= 1;

    if (
      ch === "," &&
      paren === 0 &&
      brace === 0 &&
      bracket === 0
    ) {
      args.push(
        argsText.slice(start, i).trim()
      );

      start = i + 1;
    }
  }

  args.push(
    argsText.slice(start).trim()
  );

  return args;
}

function extractConstDefinitions(text) {
  const defs = new Map();

  if (!text) {
    return defs;
  }

  const regex =
    /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;\n]+)\s*;?/g;

  let match;

  while ((match = regex.exec(text))) {
    defs.set(
      match[1],
      match[2].trim()
    );
  }

  return defs;
}

function safeEvalArithmetic(expr) {
  const cleaned =
    expr.replace(/_/g, "").trim();

  if (
    !/^[0-9+\-*/().\s]+$/.test(cleaned)
  ) {
    return null;
  }

  try {
    const value =
      Function(
        `"use strict"; return (${cleaned});`
      )();

    return Number.isFinite(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function resolveExpression(expr, defs, depth = 0) {
  if (
    expr == null ||
    depth > 8
  ) {
    return {
      resolved:
        false,

      milliseconds:
        null,

      trace: [],
    };
  }

  const trimmed =
    expr.trim();

  const direct =
    safeEvalArithmetic(trimmed);

  if (direct != null) {
    return {
      resolved:
        true,

      milliseconds:
        direct,

      trace: [
        {
          expression:
            trimmed,

          kind:
            "DIRECT_ARITHMETIC",

          value:
            direct,
        },
      ],
    };
  }

  const identifierMatch =
    trimmed.match(
      /^([A-Za-z_$][A-Za-z0-9_$]*)$/
    );

  if (identifierMatch) {
    const name =
      identifierMatch[1];

    if (defs.has(name)) {
      const rhs =
        defs.get(name);

      const nested =
        resolveExpression(
          rhs,
          defs,
          depth + 1
        );

      return {
        resolved:
          nested.resolved,

        milliseconds:
          nested.milliseconds,

        trace: [
          {
            expression:
              trimmed,

            kind:
              "CONST_REFERENCE",

            definition:
              rhs,
          },
          ...nested.trace,
        ],
      };
    }
  }

  /*
   * process.env.X ?? FALLBACK
   * process.env.X || FALLBACK
   * Number(process.env.X ?? FALLBACK)
   */
  const envFallback =
    trimmed.match(
      /(?:Number\s*\(\s*)?process\.env\.([A-Z0-9_]+)\s*(?:\?\?|\|\|)\s*([0-9_+\-*/().\s]+)\s*\)?/i
    );

  if (envFallback) {
    const envName =
      envFallback[1];

    const fallbackExpr =
      envFallback[2].trim();

    const fallbackValue =
      safeEvalArithmetic(
        fallbackExpr
      );

    return {
      resolved:
        fallbackValue != null,

      milliseconds:
        fallbackValue,

      trace: [
        {
          expression:
            trimmed,

          kind:
            "ENV_WITH_NUMERIC_FALLBACK",

          envName,

          fallbackExpression:
            fallbackExpr,

          fallbackValue,
        },
      ],
    };
  }

  /*
   * Replace known const identifiers inside a simple arithmetic expression.
   */
  let substituted =
    trimmed;

  const used = [];

  for (const [name, rhs] of defs.entries()) {
    const nested =
      resolveExpression(
        rhs,
        defs,
        depth + 1
      );

    if (
      nested.resolved &&
      nested.milliseconds != null
    ) {
      const regex =
        new RegExp(
          `\\b${name}\\b`,
          "g"
        );

      if (regex.test(substituted)) {
        substituted =
          substituted.replace(
            regex,
            String(
              nested.milliseconds
            )
          );

        used.push({
          name,
          rhs,
          value:
            nested.milliseconds,
        });
      }
    }
  }

  if (used.length > 0) {
    const value =
      safeEvalArithmetic(
        substituted
      );

    if (value != null) {
      return {
        resolved:
          true,

        milliseconds:
          value,

        trace: [
          {
            expression:
              trimmed,

            kind:
              "CONST_SUBSTITUTED_ARITHMETIC",

            substituted,

            used,
          },
        ],
      };
    }
  }

  return {
    resolved:
      false,

    milliseconds:
      null,

    trace: [
      {
        expression:
          trimmed,

        kind:
          "UNRESOLVED",
      },
    ],
  };
}

function classifyCallback(callbackText) {
  const text =
    String(callbackText ?? "");

  const callsAutomationRoute =
    /\/api\/trading\/automation\/run/i.test(
      text
    );

  const callsApprovedRoute =
    /\/api\/orders\/paper\/execute-approved/i.test(
      text
    );

  const callsExecuteApprovedFn =
    /executeApprovedPaperOrders/i.test(
      text
    );

  const uiOnlySignals =
    /setState|set[A-Z][A-Za-z0-9_]*\s*\(|refresh|dashboard|status/i.test(
      text
    ) &&
    !callsAutomationRoute &&
    !callsApprovedRoute &&
    !callsExecuteApprovedFn;

  let classification =
    "UNKNOWN_INTERVAL";

  if (
    callsAutomationRoute ||
    callsApprovedRoute ||
    callsExecuteApprovedFn
  ) {
    classification =
      "TRADING_EXECUTION_RELATED_INTERVAL";
  } else if (uiOnlySignals) {
    classification =
      "LIKELY_UI_REFRESH_INTERVAL";
  }

  return {
    classification,
    callsAutomationRoute,
    callsApprovedRoute,
    callsExecuteApprovedFn,
    uiOnlySignals,
  };
}

const results = [];

for (const target of targets.map(read)) {
  if (!target.exists) {
    results.push({
      file:
        target.file,

      exists:
        false,

      intervals: [],
    });

    continue;
  }

  const text =
    target.text;

  const defs =
    extractConstDefinitions(
      text
    );

  const intervals = [];

  let cursor = 0;

  while (true) {
    const idx =
      text.indexOf(
        "setInterval",
        cursor
      );

    if (idx < 0) {
      break;
    }

    const call =
      extractBalancedCall(
        text,
        idx,
        "setInterval"
      );

    if (!call) {
      cursor =
        idx +
        "setInterval".length;

      continue;
    }

    const args =
      splitTopLevelArgs(
        call.argsText
      );

    const callback =
      args[0] ?? "";

    const intervalExpr =
      args[1] ?? null;

    const resolved =
      resolveExpression(
        intervalExpr,
        defs
      );

    intervals.push({
      ...snippet(
        text,
        call.start,
        18
      ),

      call:
        call.text,

      callback:
        callback.slice(0, 3000),

      intervalExpression:
        intervalExpr,

      resolved,

      callbackClassification:
        classifyCallback(
          callback
        ),
    });

    cursor =
      call.end;
  }

  results.push({
    file:
      target.file,

    exists:
      true,

    intervals,

    relevantConstants:
      [...defs.entries()]
        .filter(
          ([name, rhs]) =>
            /INTERVAL|POLL|AUTOMATION|REFRESH|CADENCE|TIMEOUT/i.test(
              name +
              " " +
              rhs
            )
        )
        .map(
          ([name, rhs]) => ({
            name,
            rhs,
            resolved:
              resolveExpression(
                rhs,
                defs
              ),
          })
        ),
  });
}

const executionIntervals =
  results.flatMap(
    (row) =>
      row.intervals
        .filter(
          (interval) =>
            interval
              .callbackClassification
              .classification ===
            "TRADING_EXECUTION_RELATED_INTERVAL"
        )
        .map(
          (interval) => ({
            file:
              row.file,

            ...interval,
          })
        )
  );

const resolvedExecutionIntervals =
  executionIntervals.filter(
    (row) =>
      row.resolved.resolved &&
      Number.isFinite(
        row.resolved.milliseconds
      ) &&
      row.resolved.milliseconds > 0
  );

let recommendation = {
  executionCadenceResolved:
    false,

  executionCadenceMs:
    null,

  executionCadenceSeconds:
    null,

  executionCadenceMinutes:
    null,

  recommendedExpirySlaMs:
    null,

  recommendedExpirySlaMinutes:
    null,

  formula:
    null,
};

if (resolvedExecutionIntervals.length > 0) {
  const executionCadenceMs =
    Math.max(
      ...resolvedExecutionIntervals.map(
        (row) =>
          row.resolved.milliseconds
      )
    );

  /*
   * Conservative operational rule:
   * - allow 3 complete execution opportunities,
   * - never expire in under 2 minutes,
   * - do not exceed 15 minutes without an explicit business reason.
   */
  const recommendedExpirySlaMs =
    Math.min(
      15 * 60 * 1000,
      Math.max(
        2 * 60 * 1000,
        executionCadenceMs * 3
      )
    );

  recommendation = {
    executionCadenceResolved:
      true,

    executionCadenceMs,

    executionCadenceSeconds:
      Number(
        (
          executionCadenceMs /
          1000
        ).toFixed(2)
      ),

    executionCadenceMinutes:
      Number(
        (
          executionCadenceMs /
          60000
        ).toFixed(3)
      ),

    recommendedExpirySlaMs,

    recommendedExpirySlaMinutes:
      Number(
        (
          recommendedExpirySlaMs /
          60000
        ).toFixed(2)
      ),

    formula:
      "MAX(2_MINUTES, EXECUTION_CADENCE_X3), CAPPED_AT_15_MINUTES",
  };
}

const report = {
  status:
    "ALPHA_V3_AUTOMATION_INTERVAL_EXPRESSION_PROBE_COMPLETE",

  files:
    results,

  summary: {
    executionIntervalCount:
      executionIntervals.length,

    resolvedExecutionIntervalCount:
      resolvedExecutionIntervals.length,

    recommendation,

    executionIntervals:
      executionIntervals.map(
        (row) => ({
          file:
            row.file,

          line:
            row.line,

          intervalExpression:
            row.intervalExpression,

          resolved:
            row.resolved,

          callbackClassification:
            row.callbackClassification,

          snippet:
            row.snippet,
        })
      ),
  },

  decision: {
    safeToChooseExpirySla:
      recommendation.executionCadenceResolved,

    nextGate:
      recommendation.executionCadenceResolved
        ? "BUILD_MAINTENANCE_CALLER_WITH_RESOLVED_EXPIRY_SLA"
        : "DEFINE_EXPLICIT_AUTOMATION_CADENCE_CONTRACT",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersChanged: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-automation-interval-expression-probe.json",
};

fs.mkdirSync(
  path.dirname(reportFile),
  {
    recursive: true,
  }
);

fs.writeFileSync(
  reportFile,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      files:
        report.files.map(
          (row) => ({
            file:
              row.file,

            exists:
              row.exists,

            intervals:
              row.intervals.map(
                (interval) => ({
                  line:
                    interval.line,

                  intervalExpression:
                    interval.intervalExpression,

                  resolved:
                    interval.resolved,

                  callbackClassification:
                    interval.callbackClassification,
                })
              ),

            relevantConstants:
              row.relevantConstants ??
              [],
          })
        ),

      summary:
        report.summary,

      databaseWrites:
        0,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
