const fs = require("fs");
const path = require("path");

const root = process.cwd();
const files = [
  "lib/trading/capture-shadow-signals.ts",
  "lib/trading/evaluate-shadow-signals.ts",
];

const logRel =
  "logs/model-shadow-outcome-binding-site-probe-v1.json";

function read(rel) {
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`REQUIRED_FILE_MISSING:${rel}`);
  }
  return fs.readFileSync(abs, "utf8");
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function lines(text) {
  return text.split(/\r?\n/);
}

function context(text, line, radius = 8) {
  const arr = lines(text);
  const start = Math.max(1, line - radius);
  const end = Math.min(arr.length, line + radius);
  return {
    start,
    end,
    text: arr
      .slice(start - 1, end)
      .map((v, i) => `${start + i}: ${v}`)
      .join("\n"),
  };
}

function functions(text) {
  const out = [];
  const regex =
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?::\s*[^{]+)?\{/g;
  let m;
  while ((m = regex.exec(text))) {
    out.push({
      name: m[1],
      line: lineNumber(text, m.index),
      params: m[2].replace(/\s+/g, " ").trim().slice(0, 500),
    });
  }
  return out;
}

function variableAssignments(text) {
  const wanted = [
    "signal",
    "signals",
    "track",
    "tracks",
    "result",
    "results",
    "status",
    "signalId",
    "signal_id",
    "modelId",
    "model_id",
    "entryPrice",
    "entry_open_price",
    "return1d",
    "return3d",
    "return5d",
    "evaluationStatus",
  ];

  const out = [];
  for (const term of wanted) {
    const regex = new RegExp(
      `\\b(?:const|let)\\s+([A-Za-z0-9_]*${term}[A-Za-z0-9_]*)\\b`,
      "gi",
    );
    let m;
    while ((m = regex.exec(text)) && out.length < 120) {
      out.push({
        variable: m[1],
        line: lineNumber(text, m.index),
      });
    }
  }
  return out;
}

function dbCalls(text) {
  const out = [];
  const regex =
    /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)([\s\S]{0,1800}?)(?=;\s*(?:\n|$)|\n\s*\n|$)/g;
  let m;
  while ((m = regex.exec(text))) {
    const block = m[0];
    const kinds = [];
    for (const kind of ["select", "insert", "update", "upsert", "delete"]) {
      if (new RegExp(`\\.${kind}\\s*\\(`).test(block)) {
        kinds.push(kind);
      }
    }
    out.push({
      table: m[1],
      line: lineNumber(text, m.index),
      kinds,
      preview: block.replace(/\s+/g, " ").slice(0, 1200),
    });
  }
  return out;
}

function returnObjects(text) {
  const out = [];
  const regex = /return\s+\{([\s\S]{0,1200}?)\};/g;
  let m;
  while ((m = regex.exec(text))) {
    out.push({
      line: lineNumber(text, m.index),
      preview: m[1].replace(/\s+/g, " ").slice(0, 900),
    });
  }
  return out;
}

function objectKeyOccurrences(text) {
  const keys = [
    "id",
    "signal_id",
    "model_id",
    "stock_code",
    "status",
    "score",
    "observed_at",
    "recommended_entry_price",
    "recommended_stop_price",
    "entry_open_price",
    "return_1d",
    "return_3d",
    "return_5d",
    "max_return_1d",
    "max_return_3d",
    "max_return_5d",
    "min_return_1d",
    "min_return_3d",
    "min_return_5d",
    "evaluation_status",
    "evaluated_at",
  ];
  const out = [];
  for (const key of keys) {
    const regex = new RegExp(`\\b${key}\\b`, "g");
    let m;
    while ((m = regex.exec(text)) && out.length < 200) {
      out.push({
        key,
        line: lineNumber(text, m.index),
      });
    }
  }
  return out;
}

function targetedContexts(text) {
  const patterns = [
    { name: "AI_ENTRY_SIGNAL_INSERT", re: /\.from\(\s*["'`]ai_entry_signals["'`]\s*\)[\s\S]{0,1800}?\.insert\s*\(/g },
    { name: "AI_ENTRY_SIGNAL_UPDATE", re: /\.from\(\s*["'`]ai_entry_signals["'`]\s*\)[\s\S]{0,1800}?\.update\s*\(/g },
    { name: "AI_ENTRY_SIGNAL_SELECT", re: /\.from\(\s*["'`]ai_entry_signals["'`]\s*\)[\s\S]{0,1800}?\.select\s*\(/g },
    { name: "MARKET_SNAPSHOT_SELECT", re: /\.from\(\s*["'`]market_snapshots["'`]\s*\)[\s\S]{0,1800}?\.select\s*\(/g },
    { name: "STATUS_ASSIGNMENT", re: /\bstatus\s*[:=]\s*["'`][A-Z_]+["'`]/g },
    { name: "RETURN_CALC", re: /\b(?:return1d|return3d|return5d|return_1d|return_3d|return_5d)\b/g },
  ];

  const result = [];
  for (const { name, re } of patterns) {
    let m;
    let count = 0;
    while ((m = re.exec(text)) && count < 12) {
      const line = lineNumber(text, m.index);
      result.push({
        name,
        line,
        context: context(text, line, 10),
      });
      count += 1;
    }
  }
  return result;
}

function imports(text) {
  const out = [];
  const regex = /import\s+[\s\S]*?\s+from\s+["'`]([^"'`]+)["'`];?/g;
  let m;
  while ((m = regex.exec(text))) {
    out.push({
      source: m[1],
      line: lineNumber(text, m.index),
      preview: m[0].replace(/\s+/g, " ").slice(0, 500),
    });
  }
  return out;
}

async function main() {
  const detail = [];

  for (const rel of files) {
    const text = read(rel);
    detail.push({
      file: rel,
      lineCount: lines(text).length,
      imports: imports(text),
      functions: functions(text),
      dbCalls: dbCalls(text),
      variables: variableAssignments(text),
      objectKeys: objectKeyOccurrences(text),
      returnObjects: returnObjects(text),
      targetedContexts: targetedContexts(text),
    });
  }

  fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });
  fs.writeFileSync(
    path.resolve(root, logRel),
    JSON.stringify(
      {
        status: "MODEL_SHADOW_OUTCOME_BINDING_SITE_PROBE_V1_COMPLETE",
        files: detail,
        safety: {
          sourceFilesModified: 0,
          databaseWrites: 0,
          promotionStageChanged: false,
          ordersCreated: 0,
          positionsChanged: 0,
          controlsChanged: false,
          realTradingChanged: false,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const compact = detail.map((item) => ({
    file: item.file,
    lineCount: item.lineCount,
    functions: item.functions,
    dbCalls: item.dbCalls.map((x) => ({
      table: x.table,
      line: x.line,
      kinds: x.kinds,
    })),
    keyLines: item.objectKeys
      .filter((x) =>
        [
          "id",
          "signal_id",
          "model_id",
          "status",
          "entry_open_price",
          "return_1d",
          "return_3d",
          "return_5d",
          "evaluation_status",
          "evaluated_at",
        ].includes(x.key),
      )
      .slice(0, 80),
  }));

  console.log(
    JSON.stringify(
      {
        status: "MODEL_SHADOW_OUTCOME_BINDING_SITE_PROBE_V1_COMPLETE",
        files: compact,
        safety: {
          sourceFilesModified: 0,
          databaseWrites: 0,
          promotionStageChanged: false,
          ordersCreated: 0,
          positionsChanged: 0,
          controlsChanged: false,
          realTradingChanged: false,
        },
        nextGate:
          "PATCH_CAPTURE_AND_EVALUATE_SHADOW_PIPELINE_TO_CANONICAL_STORAGE",
        details: logRel,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "MODEL_SHADOW_OUTCOME_BINDING_SITE_PROBE_V1_FAILED",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          sourceFilesModified: 0,
          databaseWrites: 0,
          promotionStageChanged: false,
          ordersCreated: 0,
          positionsChanged: 0,
          controlsChanged: false,
          realTradingChanged: false,
        },
        nextGate: "STOP_AND_DIAGNOSE_BINDING_SITE",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
