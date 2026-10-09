const fs = require("fs");
const path = require("path");

const root = process.cwd();
const logRel =
  "logs/model-promotion-production-gate-exact-probe-v2.json";

const productionRoots = [
  path.resolve(root, "app"),
  path.resolve(root, "lib"),
];

const skipDirs = new Set([
  "node_modules",
  ".git",
  ".next",
  "logs",
  "output",
  "dist",
  "build",
  ".turbo",
  "__tests__",
  "test",
  "tests",
]);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;

  for (
    const entry of fs.readdirSync(
      dir,
      { withFileTypes: true },
    )
  ) {
    if (
      entry.isDirectory() &&
      skipDirs.has(entry.name)
    ) {
      continue;
    }

    const full =
      path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, acc);
      continue;
    }

    if (!/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
      continue;
    }

    acc.push(full);
  }

  return acc;
}

function rel(file) {
  return path
    .relative(root, file)
    .replace(/\\/g, "/");
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function lineNumber(text, index) {
  return (
    text
      .slice(0, index)
      .split(/\r?\n/)
      .length
  );
}

function excerpt(text, index, before = 5, after = 9) {
  const lines = text.split(/\r?\n/);
  const line = lineNumber(text, index);
  const start = Math.max(1, line - before);
  const end = Math.min(lines.length, line + after);

  return {
    line,
    startLine: start,
    endLine: end,
    text: lines
      .slice(start - 1, end)
      .join("\n"),
  };
}

function firstMatch(text, regex) {
  regex.lastIndex = 0;
  const match = regex.exec(text);
  if (!match) return null;
  return {
    match: match[0],
    ...excerpt(text, match.index),
  };
}

function allMatches(text, regex, max = 12) {
  const results = [];
  regex.lastIndex = 0;

  let match;
  while (
    (match = regex.exec(text)) &&
    results.length < max
  ) {
    results.push({
      match: match[0],
      ...excerpt(text, match.index, 4, 7),
    });

    if (match.index === regex.lastIndex) {
      regex.lastIndex += 1;
    }
  }

  return results;
}

function inspectPaperFile(file) {
  const text = read(file);
  const fileRel = rel(file);

  const modelRefs = allMatches(
    text,
    /\b(modelId|model_id|resolveOrderModel|resolveEntryModel|ai_model_versions)\b/gi,
    8,
  );

  const orderCreateRefs = allMatches(
    text,
    /\b(createPaperBuyOrder|create_paper_buy_order|paper_order_requests|save.*order|insert.*order|committed.*risk|reserve.*risk|autoOrder)\b/gi,
    10,
  );

  const promotionRefs = allMatches(
    text,
    /\bpromotion_stage\b/g,
    5,
  );

  const statusRefs = allMatches(
    text,
    /\b(CANDIDATE|APPROVED|PAPER|LIMITED_LIVE|PRODUCTION|DISABLED)\b/g,
    8,
  );

  if (
    modelRefs.length === 0 &&
    orderCreateRefs.length === 0
  ) {
    return null;
  }

  return {
    file: fileRel,
    modelRefs,
    orderCreateRefs,
    promotionRefs,
    statusRefs,
    flags: {
      hasModelRef: modelRefs.length > 0,
      hasOrderCreateRef: orderCreateRefs.length > 0,
      hasPromotionStageGate:
        promotionRefs.length > 0,
    },
  };
}

function inspectLiveFile(file) {
  const text = read(file);
  const fileRel = rel(file);

  const realOrderControl = allMatches(
    text,
    /\breal_order_enabled\b/g,
    8,
  );

  const promotionRefs = allMatches(
    text,
    /\bpromotion_stage\b/g,
    5,
  );

  const kisOrderEndpoint = allMatches(
    text,
    /\/uapi\/(?:domestic|overseas)-stock\/[^\s"'`]*\/(?:order|trading)[^\s"'`]*/gi,
    8,
  );

  const kisCashOrder = allMatches(
    text,
    /\b(TTTC0802U|VTTC0802U|TTTC0801U|VTTC0801U|order-cash|order_cash)\b/gi,
    8,
  );

  const submitLike = allMatches(
    text,
    /\b(submitLiveOrder|executeLiveOrder|createLiveOrder|placeLiveOrder|sendLiveOrder|liveOrder)\b/gi,
    8,
  );

  const writeLike = allMatches(
    text,
    /\b(fetch|axios|request)\s*\([\s\S]{0,350}?(order-cash|TTTC0802U|VTTC0802U|TTTC0801U|VTTC0801U)/gi,
    6,
  );

  const modelRefs = allMatches(
    text,
    /\b(modelId|model_id|ai_model_versions)\b/gi,
    8,
  );

  const executionCapable =
    kisOrderEndpoint.length > 0 ||
    kisCashOrder.length > 0 ||
    submitLike.length > 0 ||
    writeLike.length > 0;

  const controlOnly =
    realOrderControl.length > 0 &&
    !executionCapable;

  if (
    realOrderControl.length === 0 &&
    !executionCapable
  ) {
    return null;
  }

  return {
    file: fileRel,
    executionCapable,
    controlOnly,
    realOrderControl,
    kisOrderEndpoint,
    kisCashOrder,
    submitLike,
    writeLike,
    modelRefs,
    promotionRefs,
    flags: {
      hasRealOrderControl:
        realOrderControl.length > 0,
      hasModelRef:
        modelRefs.length > 0,
      hasPromotionStageGate:
        promotionRefs.length > 0,
    },
  };
}

function summarizePaper(paper) {
  return paper
    .filter(Boolean)
    .map((item) => ({
      file: item.file,
      hasModelRef: item.flags.hasModelRef,
      hasOrderCreateRef:
        item.flags.hasOrderCreateRef,
      hasPromotionStageGate:
        item.flags.hasPromotionStageGate,
      modelLines:
        item.modelRefs.map((x) => x.line),
      orderCreateLines:
        item.orderCreateRefs.map((x) => x.line),
    }));
}

function summarizeLive(live) {
  return live
    .filter(Boolean)
    .map((item) => ({
      file: item.file,
      executionCapable:
        item.executionCapable,
      controlOnly:
        item.controlOnly,
      hasRealOrderControl:
        item.flags.hasRealOrderControl,
      hasModelRef:
        item.flags.hasModelRef,
      hasPromotionStageGate:
        item.flags.hasPromotionStageGate,
      endpointLines:
        item.kisOrderEndpoint
          .map((x) => x.line),
      trIdLines:
        item.kisCashOrder
          .map((x) => x.line),
      submitLines:
        item.submitLike
          .map((x) => x.line),
    }));
}

async function main() {
  const files = [];

  for (const dir of productionRoots) {
    walk(dir, files);
  }

  const paper = [];
  const live = [];

  for (const file of files) {
    const p = inspectPaperFile(file);
    if (p) paper.push(p);

    const l = inspectLiveFile(file);
    if (l) live.push(l);
  }

  const paperSummary =
    summarizePaper(paper);

  const liveSummary =
    summarizeLive(live);

  const exactPaperRiskFiles =
    paperSummary.filter(
      (x) =>
        x.hasOrderCreateRef ||
        (
          x.hasModelRef &&
          /paper|entry|order/i.test(x.file)
        ),
    );

  const liveExecutionFiles =
    liveSummary.filter(
      (x) =>
        x.executionCapable,
    );

  const liveControlOnlyFiles =
    liveSummary.filter(
      (x) =>
        x.controlOnly,
    );

  const recommendedPaperGateLayers = [];

  const entrySignal =
    exactPaperRiskFiles.find(
      (x) =>
        x.file ===
        "lib/trading/generate-entry-signals.ts",
    );

  const paperService =
    exactPaperRiskFiles.find(
      (x) =>
        x.file ===
        "lib/trading/paper-order-service.ts",
    );

  const paperRoute =
    exactPaperRiskFiles.find(
      (x) =>
        x.file ===
        "app/api/orders/paper/route.ts",
    );

  if (entrySignal) {
    recommendedPaperGateLayers.push({
      layer: "SIGNAL_TO_ORDER_BOUNDARY",
      file: entrySignal.file,
      reason:
        "autoOrder may convert a model signal into new PAPER risk; reject unless promotion_stage permits PAPER risk.",
    });
  }

  if (paperService) {
    recommendedPaperGateLayers.push({
      layer: "PAPER_ORDER_SERVICE_BOUNDARY",
      file: paperService.file,
      reason:
        "authoritative service defense-in-depth for all callers; resolve model promotion_stage before reservation/order creation.",
    });
  }

  if (paperRoute) {
    recommendedPaperGateLayers.push({
      layer: "API_BOUNDARY",
      file: paperRoute.file,
      reason:
        "early fail-closed response for direct API callers; service layer must remain authoritative.",
    });
  }

  const result = {
    status:
      "MODEL_PROMOTION_PRODUCTION_GATE_EXACT_PROBE_V2_COMPLETE",

    scanned: {
      productionFiles:
        files.length,
      roots: [
        "app/",
        "lib/",
      ],
      scriptsExcluded: true,
    },

    paper: {
      exactRiskFiles:
        exactPaperRiskFiles,
      recommendedGateLayers:
        recommendedPaperGateLayers,
      missingPromotionGateFiles:
        exactPaperRiskFiles
          .filter(
            (x) =>
              !x.hasPromotionStageGate,
          )
          .map((x) => x.file),
    },

    live: {
      executionFileCount:
        liveExecutionFiles.length,
      executionFiles:
        liveExecutionFiles,
      controlOnlyFiles:
        liveControlOnlyFiles,
      conclusion:
        liveExecutionFiles.length === 0
          ? "NO_PRODUCTION_LIVE_ORDER_WRITER_FOUND_IN_APP_OR_LIB"
          : "PRODUCTION_LIVE_ORDER_WRITER_FOUND",
    },

    safety: {
      sourceFilesModified: 0,
      databaseReads: 0,
      databaseWrites: 0,
      networkCalls: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      controlsChanged: false,
      realTradingChanged: false,
    },

    nextGate:
      liveExecutionFiles.length === 0
        ? "BIND_PAPER_PROMOTION_GATE_NOW_AND_KEEP_LIVE_FAIL_CLOSED_UNTIL_LIVE_WRITER_EXISTS"
        : "BIND_PAPER_AND_EXACT_LIVE_PROMOTION_GATES",

    details:
      logRel,
  };

  fs.mkdirSync(
    path.resolve(root, "logs"),
    { recursive: true },
  );

  fs.writeFileSync(
    path.resolve(root, logRel),
    JSON.stringify(
      {
        ...result,
        paperDetails: paper,
        liveDetails: live,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "MODEL_PROMOTION_PRODUCTION_GATE_EXACT_PROBE_V2_FAILED",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          sourceFilesModified: 0,
          databaseWrites: 0,
          ordersCreated: 0,
          positionsChanged: 0,
          controlsChanged: false,
          realTradingChanged: false,
        },
        nextGate:
          "STOP_AND_DIAGNOSE",
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
