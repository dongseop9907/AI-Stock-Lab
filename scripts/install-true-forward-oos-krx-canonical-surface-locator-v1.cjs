const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SCRIPTS =
  path.join(
    ROOT,
    "scripts"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const BACKUPS =
  path.join(
    SCRIPTS,
    "backups"
  );

const TARGET =
  path.join(
    SCRIPTS,
    "true-forward-oos-krx-canonical-surface-locator-v1.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_CANONICAL_SURFACE_LOCATOR_V1_INSTALL_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

const required = [
  "package.json",
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
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

if (
  missing.length > 0
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    }
  );
} else {
  fs.mkdirSync(
    BACKUPS,
    {
      recursive: true
    }
  );

  const packageBackup =
    path.join(
      BACKUPS,
      "package.before-true-forward-oos-krx-canonical-surface-locator-v1.json"
    );

  if (
    !fs.existsSync(
      packageBackup
    )
  ) {
    fs.copyFileSync(
      PACKAGE,
      packageBackup
    );
  }

  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst SEARCH_ROOTS = [\n  \"lib\",\n  \"scripts\",\n  \"app\",\n];\n\nconst NEEDLES = [\n  \"nextKrxTradingDate\",\n  \"market_exchange_calendar_overrides\",\n  \"is_open\",\n  \"targetSessionDate\",\n  \"WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES\",\n  \"MANUAL_VERIFIED_KRX_CALENDAR\",\n];\n\nconst IGNORE_DIRS = new Set([\n  \"node_modules\",\n  \".next\",\n  \".git\",\n  \"logs\",\n  \"backups\",\n  \"dist\",\n  \"build\",\n  \"coverage\",\n]);\n\nconst ALLOWED_EXT =\n  /\\.(ts|tsx|js|cjs|mjs)$/i;\n\nfunction walk(absDir, relBase, out) {\n  if (!fs.existsSync(absDir)) {\n    return;\n  }\n\n  for (const entry of fs.readdirSync(absDir, {\n    withFileTypes: true,\n  })) {\n    if (\n      entry.isDirectory() &&\n      IGNORE_DIRS.has(entry.name)\n    ) {\n      continue;\n    }\n\n    const abs =\n      path.join(absDir, entry.name);\n\n    const rel =\n      path.join(relBase, entry.name)\n        .replace(/\\\\/g, \"/\");\n\n    if (entry.isDirectory()) {\n      walk(abs, rel, out);\n      continue;\n    }\n\n    if (\n      entry.isFile() &&\n      ALLOWED_EXT.test(entry.name)\n    ) {\n      out.push({\n        abs,\n        rel,\n      });\n    }\n  }\n}\n\nconst files = [];\n\nfor (const root of SEARCH_ROOTS) {\n  walk(\n    path.join(ROOT, root),\n    root,\n    files\n  );\n}\n\nconst matches = [];\n\nfor (const file of files) {\n  let text = \"\";\n\n  try {\n    text =\n      fs.readFileSync(\n        file.abs,\n        \"utf8\"\n      );\n  } catch {\n    continue;\n  }\n\n  const lines =\n    text.split(/\\r?\\n/);\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i++\n  ) {\n    const line =\n      lines[i];\n\n    const found =\n      NEEDLES.filter(\n        needle =>\n          line.includes(needle)\n      );\n\n    if (\n      found.length === 0\n    ) {\n      continue;\n    }\n\n    const start =\n      Math.max(\n        0,\n        i - 2\n      );\n\n    const end =\n      Math.min(\n        lines.length,\n        i + 3\n      );\n\n    matches.push({\n      file:\n        file.rel,\n\n      line:\n        i + 1,\n\n      needles:\n        found,\n\n      snippet:\n        lines\n          .slice(start, end)\n          .map(\n            (value, index) =>\n              `${start + index + 1}: ${value}`\n          ),\n    });\n  }\n}\n\nconst definitions =\n  matches.filter(\n    row =>\n      row.snippet.some(\n        line =>\n          /(function\\s+nextKrxTradingDate|const\\s+nextKrxTradingDate|export\\s+.*nextKrxTradingDate|function\\s+.*Trading.*Date|market_exchange_calendar_overrides)/i.test(\n            line\n          )\n      )\n  );\n\nconst candidateFiles =\n  [...new Set(\n    matches.map(\n      row => row.file\n    )\n  )];\n\nconst likelySharedLibs =\n  candidateFiles.filter(\n    file =>\n      file.startsWith(\"lib/\")\n  );\n\nconst producerOnly =\n  candidateFiles.filter(\n    file =>\n      file.includes(\n        \"alpha-v3-true-forward-top1-producer-v1\"\n      )\n  );\n\nlet recommendedReuseMode;\n\nif (\n  likelySharedLibs.length > 0\n) {\n  recommendedReuseMode =\n    \"REUSE_EXISTING_LIB_CALENDAR_SURFACE\";\n} else if (\n  producerOnly.length > 0\n) {\n  recommendedReuseMode =\n    \"EXTRACT_CANONICAL_KRX_CALENDAR_SURFACE_FROM_PRODUCER_BEFORE_BINDING\";\n} else {\n  recommendedReuseMode =\n    \"INSPECT_MATCHES_BEFORE_IMPLEMENTATION\";\n}\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_CANONICAL_SURFACE_LOCATOR_V1_COMPLETE\",\n\n  recommendedReuseMode,\n\n  candidateFiles,\n  likelySharedLibs,\n\n  definitionMatches:\n    definitions.slice(\n      0,\n      20\n    ),\n\n  allMatches:\n    matches.slice(\n      0,\n      80\n    ),\n\n  safety: {\n    readOnly:\n      true,\n\n    productSourceChanges:\n      0,\n\n    databaseWrites:\n      0,\n\n    ordersCreated:\n      0,\n\n    positionsChanged:\n      0,\n\n    realTradingEnabled:\n      false,\n  },\n\n  nextGate:\n    recommendedReuseMode ===\n      \"REUSE_EXISTING_LIB_CALENDAR_SURFACE\"\n      ? \"PATCH_AUTOMATION_BINDING_TO_EXISTING_LIB_KRX_CALENDAR_SURFACE\"\n      : recommendedReuseMode ===\n        \"EXTRACT_CANONICAL_KRX_CALENDAR_SURFACE_FROM_PRODUCER_BEFORE_BINDING\"\n      ? \"EXTRACT_SHARED_KRX_CALENDAR_HELPER_THEN_BIND\"\n      : \"REVIEW_KRX_SURFACE_MATCHES\",\n};\n\nfs.mkdirSync(\n  path.join(\n    ROOT,\n    \"logs\"\n  ),\n  {\n    recursive: true\n  }\n);\n\nfs.writeFileSync(\n  path.join(\n    ROOT,\n    \"logs\",\n    \"true-forward-oos-krx-canonical-surface-locator-v1.json\"\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2\n  ),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify({\n  status:\n    report.status,\n\n  recommendedReuseMode:\n    report.recommendedReuseMode,\n\n  candidateFiles:\n    report.candidateFiles.slice(\n      0,\n      20\n    ),\n\n  likelySharedLibs:\n    report.likelySharedLibs.slice(\n      0,\n      10\n    ),\n\n  definitionMatches:\n    report.definitionMatches.slice(\n      0,\n      8\n    ),\n\n  nextGate:\n    report.nextGate,\n}, null, 2));\n\nprocess.exitCode = 0;\n",
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (
    error
  ) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (
    pkg
  ) {
    if (
      !pkg.scripts ||
      typeof pkg.scripts !==
        "object"
    ) {
      pkg.scripts = {};
    }

    pkg.scripts[
      "test:true-forward-oos-krx-canonical-surface"
    ] =
      "node ./scripts/true-forward-oos-krx-canonical-surface-locator-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_CANONICAL_SURFACE_LOCATOR_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-krx-canonical-surface-locator-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-krx-canonical-surface",

          mode:
            "READ_ONLY_PROJECT_SOURCE_LOCATOR",

          safety: {
            productSourceChanges:
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

          nextAction:
            "RUN_COMPACT_CANONICAL_KRX_SURFACE_LOCATOR",
        },
        null,
        2
      )
    );
  }
}
