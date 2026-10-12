const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const MAX_FILE_BYTES =
  700 * 1024;

const RELEVANT_LOGS = [
  "logs/alpha-v3-entry-v3-forward-oos-observations.json",
  "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  "logs/alpha-v3-true-forward-oos-summary.json",
  "logs/true-forward-oos-controlled-producer-evidence-run-v1.json",
  "logs/alpha-v3-true-forward-oos-manual-review-packet-v1.json",
  "logs/alpha-v3-true-forward-oos-manual-review-decision-v1.json",
  "logs/true-forward-oos-automation-binding-v1-state.json",
  "logs/true-forward-oos-krx-maturity-semantics-exact-probe-v3.json",
];

const RELEVANT_SOURCE_FILES = [
  "scripts/alpha-v3-true-forward-oos-summary.ts",
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
];

function walk(
  dir,
  out = [],
) {
  if (!fs.existsSync(dir)) {
    return out;
  }

  for (const entry of fs.readdirSync(
    dir,
    { withFileTypes: true },
  )) {
    const full =
      path.join(
        dir,
        entry.name,
      );

    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git"
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(
        full,
        out,
      );
    } else {
      out.push(
        full,
      );
    }
  }

  return out;
}

function rel(
  file,
) {
  return path
    .relative(
      ROOT,
      file,
    )
    .replaceAll(
      "\\",
      "/",
    );
}

function safeRead(
  file,
) {
  try {
    const stat =
      fs.statSync(
        file,
      );

    if (
      stat.size >
      MAX_FILE_BYTES
    ) {
      return null;
    }

    return fs.readFileSync(
      file,
      "utf8",
    );
  } catch {
    return null;
  }
}

function jsonShape(
  value,
  depth = 0,
) {
  if (
    depth >= 4
  ) {
    return typeof value;
  }

  if (
    value === null
  ) {
    return "null";
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return {
      type:
        "array",

      length:
        value.length,

      item:
        value.length > 0
          ? jsonShape(
              value[0],
              depth + 1,
            )
          : null,
    };
  }

  if (
    typeof value ===
    "object"
  ) {
    return Object.fromEntries(
      Object.entries(
        value,
      )
        .slice(
          0,
          80,
        )
        .map(
          ([key, item]) => [
            key,
            jsonShape(
              item,
              depth + 1,
            ),
          ],
        ),
    );
  }

  return typeof value;
}

function inspectJson(
  relPath,
) {
  const full =
    path.join(
      ROOT,
      relPath,
    );

  if (
    !fs.existsSync(
      full,
    )
  ) {
    return {
      file:
        relPath,

      exists:
        false,
    };
  }

  try {
    const parsed =
      JSON.parse(
        fs.readFileSync(
          full,
          "utf8",
        ),
      );

    return {
      file:
        relPath,

      exists:
        true,

      shape:
        jsonShape(
          parsed,
        ),
    };
  } catch (
    error
  ) {
    return {
      file:
        relPath,

      exists:
        true,

      parseError:
        String(
          error instanceof Error
            ? error.message
            : error,
        ),
    };
  }
}

function extractInterestingLines(
  source,
) {
  const tokens = [
    "forward",
    "oos",
    "sidebar",
    "navigation",
    "nav",
    "dashboard",
    "summary",
    "maturity",
    "readiness",
    "fill",
    "paired",
    "qualified",
    "session",
    "return",
    "drawdown",
    "regime",
    "slippage",
    "expectancy",
  ];

  return source
    .split(/\r?\n/)
    .map(
      (text, index) => ({
        line:
          index + 1,

        text,
      }),
    )
    .filter(
      row => {
        const lower =
          row.text
            .toLowerCase();

        return tokens.some(
          token =>
            lower.includes(
              token,
            ),
        );
      },
    )
    .slice(
      0,
      120,
    );
}

const appDir =
  path.join(
    ROOT,
    "app",
  );

const srcAppDir =
  path.join(
    ROOT,
    "src",
    "app",
  );

const appRoot =
  fs.existsSync(
    appDir,
  )
    ? appDir
    : (
        fs.existsSync(
          srcAppDir,
        )
          ? srcAppDir
          : null
      );

const projectFiles =
  walk(
    ROOT,
  );

const uiCandidates =
  projectFiles
    .filter(
      file => {
        const r =
          rel(
            file,
          );

        const lower =
          r.toLowerCase();

        return (
          (
            lower.endsWith(
              ".tsx",
            ) ||
            lower.endsWith(
              ".ts",
            )
          ) &&
          (
            lower.includes(
              "sidebar",
            ) ||
            lower.includes(
              "nav",
            ) ||
            lower.endsWith(
              "/page.tsx",
            ) ||
            lower.endsWith(
              "/layout.tsx",
            )
          )
        );
      },
    )
    .slice(
      0,
      120,
    );

const uiInspection =
  uiCandidates
    .map(
      file => {
        const source =
          safeRead(
            file,
          );

        if (
          source === null
        ) {
          return null;
        }

        return {
          file:
            rel(
              file,
            ),

          hasAiStockLab:
            source.includes(
              "AI STOCK LAB",
            ),

          hasSidebar:
            source.includes(
              "Sidebar",
            ) ||
            source
              .toLowerCase()
              .includes(
                "sidebar",
              ),

          hasForwardOos:
            source
              .toLowerCase()
              .includes(
                "forward",
              ) &&
            source
              .toLowerCase()
              .includes(
                "oos",
              ),

          interestingLines:
            extractInterestingLines(
              source,
            ),
        };
      },
    )
    .filter(Boolean);

let packageJson = {};

try {
  packageJson =
    JSON.parse(
      fs.readFileSync(
        path.join(
          ROOT,
          "package.json",
        ),
        "utf8",
      ),
    );
} catch {}

const sourceInspection =
  RELEVANT_SOURCE_FILES
    .map(
      relPath => {
        const full =
          path.join(
            ROOT,
            relPath,
          );

        if (
          !fs.existsSync(
            full,
          )
        ) {
          return {
            file:
              relPath,

            exists:
              false,
          };
        }

        const source =
          safeRead(
            full,
          );

        return {
          file:
            relPath,

          exists:
            true,

          interestingLines:
            source
              ? extractInterestingLines(
                  source,
                )
              : [],
        };
      },
    );

const logInspection =
  RELEVANT_LOGS
    .map(
      inspectJson,
    );

const existingForwardRoutes =
  uiInspection
    .filter(
      row =>
        row.hasForwardOos,
    )
    .map(
      row =>
        row.file,
    );

const sidebarCandidates =
  uiInspection
    .filter(
      row =>
        row.hasSidebar ||
        row.hasAiStockLab,
    )
    .map(
      row =>
        row.file,
    );

const pageCandidates =
  uiInspection
    .filter(
      row =>
        row.file.endsWith(
          "/page.tsx",
        ) ||
        row.file ===
          "app/page.tsx" ||
        row.file ===
          "src/app/page.tsx",
    )
    .map(
      row =>
        row.file,
    );

const report = {
  status:
    "AI_STOCK_LAB_FORWARD_OOS_OBSERVABILITY_DASHBOARD_SURFACE_PROBE_V1_COMPLETE",

  app: {
    appRoot:
      appRoot
        ? rel(
            appRoot,
          )
        : null,

    nextVersion:
      packageJson
        ?.dependencies
        ?.next ??
      packageJson
        ?.devDependencies
        ?.next ??
      null,

    reactVersion:
      packageJson
        ?.dependencies
        ?.react ??
      packageJson
        ?.devDependencies
        ?.react ??
      null,

    pageCandidates,

    sidebarCandidates,

    existingForwardRoutes,
  },

  logs:
    logInspection,

  sourceInspection,

  uiInspection,

  recommendedV1: {
    route:
      appRoot
        ? (
            rel(
              appRoot,
            ) +
            "/forward-oos/page.tsx"
          )
        : null,

    apiRoute:
      appRoot
        ? (
            rel(
              appRoot,
            ) +
            "/api/forward-oos/observability/route.ts"
          )
        : null,

    mode:
      "READ_ONLY_LOG_FILE_DASHBOARD",

    panels: [
      "Readiness / current gate",
      "Forward sessions",
      "1D / 3D / 5D maturity",
      "Qualified sample",
      "Fill rate",
      "Paired-positive rate",
      "Forward OOS final gate",
      "Next maturity / next action",
      "Data-quality warnings",
    ],

    frozenLogicTouched:
      false,
  },

  safety: {
    sourceOnly:
      true,

    productionUiChanged:
      false,

    alphaChanged:
      false,

    producerChanged:
      false,

    collectorChanged:
      false,

    forwardDatasetChanged:
      false,

    databaseReads:
      0,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    promotionExecuted:
      false,

    realTradingEnabled:
      false,
  },

  nextGate:
    appRoot
      ? "BUILD_FORWARD_OOS_OBSERVABILITY_DASHBOARD_V1_FROM_DISCOVERED_SURFACES"
      : "STOP_AND_RESOLVE_NEXT_APP_ROOT",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs",
  ),
  {
    recursive:
      true,
  },
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "forward-oos-observability-dashboard-surface-probe-v1.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode =
  appRoot
    ? 0
    : 1;
