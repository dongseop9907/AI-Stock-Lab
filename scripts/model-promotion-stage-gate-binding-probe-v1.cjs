const fs = require("fs");
const path = require("path");

const root = process.cwd();

const logRel =
  "logs/model-promotion-stage-gate-binding-probe-v1.json";

const targets = [
  "lib/models/model-governance.ts",
  "lib/models/resolve-order-model.ts",
  "lib/trading/generate-entry-signals.ts",
  "lib/trading/paper-order-service.ts",
  "lib/trading/committed-risk-reservation.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "app/api/orders/paper/route.ts",
  "app/api/orders/paper/execute/route.ts",
  "app/api/orders/paper/execute-approved/route.ts",
  "app/api/orders/live/route.ts",
  "lib/trading/get-trading-system-control.ts",
];

function read(rel) {
  const abs =
    path.resolve(
      root,
      rel,
    );

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs.readFileSync(
    abs,
    "utf8",
  );
}

function lineOf(text, index) {
  return (
    text
      .slice(0, index)
      .split(/\r?\n/)
      .length
  );
}

function findMatches(
  text,
  regex,
  max = 20,
) {
  const results = [];
  let match;

  regex.lastIndex = 0;

  while (
    (match = regex.exec(text)) &&
    results.length < max
  ) {
    results.push({
      line:
        lineOf(
          text,
          match.index,
        ),
      text:
        match[0]
          .replace(/\s+/g, " ")
          .slice(0, 220),
    });

    if (
      match.index ===
      regex.lastIndex
    ) {
      regex.lastIndex += 1;
    }
  }

  return results;
}

function inspect(rel) {
  const text =
    read(rel);

  if (text === null) {
    return {
      file: rel,
      exists: false,
    };
  }

  const modelId =
    findMatches(
      text,
      /\b(modelId|model_id|ai_model_versions|resolveOrderModel|resolveEntryModel)\b/gi,
    );

  const paperRisk =
    findMatches(
      text,
      /\b(create.*paper|paper.*order|RISK_APPROVED|reserve.*risk|committed.*risk|autoOrder)\b/gi,
    );

  const liveRisk =
    findMatches(
      text,
      /\b(real_order_enabled|live.*order|submit.*live|KIS|kis.*order|real.*trade)\b/gi,
    );

  const controls =
    findMatches(
      text,
      /\b(emergency_stop|paper_order_enabled|real_order_enabled|automation_enabled|getTradingSystemControl)\b/gi,
    );

  const status =
    findMatches(
      text,
      /\b(status|promotion_stage|CANDIDATE|APPROVED|PAPER|LIMITED_LIVE|PRODUCTION)\b/g,
    );

  const writers =
    findMatches(
      text,
      /\.from\(\s*["']ai_model_versions["']\s*\)[\s\S]{0,1200}?\.(update|insert|upsert)\s*\(/g,
      10,
    );

  return {
    file: rel,
    exists: true,
    lineCount:
      text.split(/\r?\n/).length,
    modelId,
    paperRisk,
    liveRisk,
    controls,
    status,
    writers,
    flags: {
      hasModelId:
        modelId.length > 0,
      hasPaperRiskSurface:
        paperRisk.length > 0,
      hasLiveRiskSurface:
        liveRisk.length > 0,
      hasControlRead:
        controls.length > 0,
      hasPromotionStage:
        /\bpromotion_stage\b/.test(text),
      hasAiModelVersions:
        /\bai_model_versions\b/.test(text),
    },
  };
}

function walk(
  dir,
  acc = [],
) {
  const skip =
    new Set([
      "node_modules",
      ".git",
      ".next",
      "logs",
      "output",
      "dist",
      "build",
      ".turbo",
    ]);

  for (
    const entry of
    fs.readdirSync(
      dir,
      {
        withFileTypes: true,
      },
    )
  ) {
    if (
      entry.isDirectory() &&
      skip.has(entry.name)
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name,
      );

    if (entry.isDirectory()) {
      walk(full, acc);
      continue;
    }

    if (
      !/\.(ts|tsx|js|cjs|mjs)$/.test(
        entry.name,
      )
    ) {
      continue;
    }

    acc.push(full);
  }

  return acc;
}

function discoverLiveCandidates() {
  const candidates = [];

  for (
    const full of
    walk(root)
  ) {
    const rel =
      path
        .relative(root, full)
        .replace(/\\/g, "/");

    const text =
      fs.readFileSync(
        full,
        "utf8",
      );

    if (
      /\breal_order_enabled\b/.test(text) ||
      /\b(LIMITED_LIVE|PRODUCTION)\b/.test(text) ||
      /\b(kis.*order|order.*kis|submit.*live|live.*order)\b/i.test(text)
    ) {
      candidates.push({
        file: rel,
        flags: {
          realOrderEnabled:
            /\breal_order_enabled\b/.test(text),
          promotionStage:
            /\bpromotion_stage\b/.test(text),
          modelId:
            /\b(modelId|model_id)\b/.test(text),
          kisOrder:
            /\b(kis.*order|order.*kis)\b/i.test(text),
        },
      });
    }
  }

  return candidates
    .slice(0, 80);
}

async function readDbState() {
  function firstEnv(names) {
    for (const name of names) {
      const value =
        process.env[name];

      if (
        typeof value === "string" &&
        value.trim()
      ) {
        return value.trim();
      }
    }

    return null;
  }

  const urlRaw =
    firstEnv([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    ]);

  const key =
    firstEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    ]);

  if (!urlRaw || !key) {
    return {
      available: false,
      reason: "ENV_MISSING",
    };
  }

  const url =
    urlRaw.replace(/\/+$/, "");

  const [
    modelsResponse,
    controlResponse,
  ] =
    await Promise.all([
      fetch(
        `${url}/rest/v1/ai_model_versions?select=id,model_name,model_version,purpose,status,promotion_stage&order=created_at.asc`,
        {
          headers: {
            apikey: key,
            Authorization:
              `Bearer ${key}`,
            Accept:
              "application/json",
          },
        },
      ),
      fetch(
        `${url}/rest/v1/trading_system_controls?control_key=eq.global&select=emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled&limit=1`,
        {
          headers: {
            apikey: key,
            Authorization:
              `Bearer ${key}`,
            Accept:
              "application/json",
          },
        },
      ),
    ]);

  const modelsText =
    await modelsResponse.text();

  const controlText =
    await controlResponse.text();

  return {
    available:
      modelsResponse.ok &&
      controlResponse.ok,
    models:
      modelsResponse.ok
        ? JSON.parse(modelsText)
        : {
            error:
              modelsText.slice(0, 500),
          },
    controls:
      controlResponse.ok
        ? JSON.parse(controlText)[0] ?? null
        : {
            error:
              controlText.slice(0, 500),
          },
  };
}

async function main() {
  const surfaces =
    targets.map(inspect);

  const liveCandidates =
    discoverLiveCandidates();

  const db =
    await readDbState();

  const paperCandidates =
    surfaces
      .filter(
        (item) =>
          item.exists &&
          item.flags?.hasPaperRiskSurface,
      )
      .map(
        (item) => ({
          file:
            item.file,
          hasModelId:
            item.flags.hasModelId,
          hasPromotionStage:
            item.flags.hasPromotionStage,
          hasControlRead:
            item.flags.hasControlRead,
        }),
      );

  const explicitLiveCandidates =
    liveCandidates.filter(
      (item) =>
        item.flags.realOrderEnabled ||
        item.flags.kisOrder,
    );

  const gaps = [];

  if (
    paperCandidates.some(
      (item) =>
        item.hasModelId &&
        !item.hasPromotionStage,
    )
  ) {
    gaps.push(
      "PAPER_RISK_PATH_HAS_MODEL_ID_BUT_NO_PROMOTION_STAGE_GATE",
    );
  }

  if (
    explicitLiveCandidates.some(
      (item) =>
        !item.flags.promotionStage,
    )
  ) {
    gaps.push(
      "LIVE_CAPABLE_PATH_WITHOUT_PROMOTION_STAGE_GATE",
    );
  }

  const result = {
    status:
      "MODEL_PROMOTION_STAGE_GATE_BINDING_PROBE_V1_COMPLETE",

    targetSurfaceCount:
      surfaces.length,

    paperCandidates,

    liveCandidateCount:
      explicitLiveCandidates.length,

    liveCandidates:
      explicitLiveCandidates
        .slice(0, 30),

    db: {
      available:
        db.available,
      models:
        Array.isArray(db.models)
          ? db.models
          : db.models,
      controls:
        db.controls,
    },

    gaps,

    safety: {
      sourceFilesModified: 0,
      databaseReadsOnly: true,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      controlsChanged: false,
      realTradingChanged: false,
    },

    nextGate:
      "PATCH_EXACT_PAPER_AND_LIVE_RISK_ENTRY_SURFACES_WITH_PROMOTION_STAGE_GATES",

    details:
      logRel,
  };

  fs.mkdirSync(
    path.resolve(
      root,
      "logs",
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.resolve(
      root,
      logRel,
    ),
    JSON.stringify(
      {
        ...result,
        surfaces,
        allLiveCandidates:
          liveCandidates,
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

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_PROMOTION_STAGE_GATE_BINDING_PROBE_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            databaseWrites: 0,
            sourceFilesModified: 0,
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

    process.exitCode =
      1;
  },
);
