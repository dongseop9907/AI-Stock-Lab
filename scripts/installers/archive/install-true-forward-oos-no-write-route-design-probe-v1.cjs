const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-no-write-route-design-probe-v1.cjs"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_NO_WRITE_ROUTE_DESIGN_PROBE_V1_INSTALL_FAILED",

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
  "app/api/trading/automation/cycle/route.ts",
  "app/api/trading/automation/run/route.ts",
  "package.json",
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
  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGETS = [\n  \"app/api/trading/automation/cycle/route.ts\",\n  \"app/api/trading/automation/run/route.ts\",\n];\n\nfunction read(rel) {\n  return fs.readFileSync(\n    path.join(ROOT, rel),\n    \"utf8\"\n  );\n}\n\nfunction collect(text) {\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const hits = [];\n\n  const patterns = [\n    /export\\s+(?:async\\s+)?function\\s+POST/,\n    /request\\.json\\s*\\(/,\n    /\\.json\\s*\\(/,\n    /TRADING_AUTOMATION_SECRET/,\n    /authorization/i,\n    /bearer/i,\n    /create.*order/i,\n    /place.*order/i,\n    /submit.*order/i,\n    /paper.*order/i,\n    /order.*service/i,\n    /\\.(insert|update|upsert|delete)\\s*\\(/i,\n    /createSupabaseServerClient/,\n    /runAutomation/i,\n    /run.*Cycle/i,\n    /run.*Trading/i,\n    /return\\s+NextResponse\\.json/,\n    /NextResponse\\.json/,\n    /dry.?run/i,\n    /preview/i,\n    /smoke/i,\n  ];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i++\n  ) {\n    if (\n      patterns.some(\n        re => re.test(lines[i])\n      )\n    ) {\n      const start =\n        Math.max(\n          0,\n          i - 3\n        );\n\n      const end =\n        Math.min(\n          lines.length,\n          i + 7\n        );\n\n      hits.push({\n        anchorLine:\n          i + 1,\n\n        snippet:\n          lines\n            .slice(start, end)\n            .map(\n              (line, offset) => ({\n                line:\n                  start + offset + 1,\n\n                text:\n                  line,\n              })\n            ),\n      });\n    }\n  }\n\n  return hits.slice(0, 50);\n}\n\nconst missing =\n  TARGETS.filter(\n    rel =>\n      !fs.existsSync(\n        path.join(ROOT, rel)\n      )\n  );\n\nif (\n  missing.length > 0\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_NO_WRITE_ROUTE_DESIGN_PROBE_V1_FAILED\",\n\n        reason:\n          \"REQUIRED_ROUTE_FILES_MISSING\",\n\n        missing,\n      },\n      null,\n      2\n    )\n  );\n\n  process.exitCode = 1;\n} else {\n  const routes =\n    TARGETS.map(\n      rel => {\n        const text =\n          read(rel);\n\n        const postIndex =\n          text.search(\n            /export\\s+(?:async\\s+)?function\\s+POST/\n          );\n\n        const firstWriteIndex =\n          text.search(\n            /\\.(insert|update|upsert|delete)\\s*\\(|create.*order|place.*order|submit.*order|paper.*order|order.*service/i\n          );\n\n        const authIndex =\n          text.search(\n            /TRADING_AUTOMATION_SECRET|authorization|bearer/i\n          );\n\n        const jsonIndex =\n          text.search(\n            /request\\.json\\s*\\(|\\.json\\s*\\(/i\n          );\n\n        return {\n          file:\n            rel,\n\n          postFound:\n            postIndex >= 0,\n\n          requestJsonFound:\n            jsonIndex >= 0,\n\n          authFound:\n            authIndex >= 0,\n\n          writeOrOrderFound:\n            firstWriteIndex >= 0,\n\n          authBeforeWrite:\n            authIndex >= 0 &&\n            firstWriteIndex >= 0 &&\n            authIndex <\n              firstWriteIndex,\n\n          jsonBeforeWrite:\n            jsonIndex >= 0 &&\n            firstWriteIndex >= 0 &&\n            jsonIndex <\n              firstWriteIndex,\n\n          canInsertEarlyNoWriteGuard:\n            postIndex >= 0 &&\n            firstWriteIndex >= 0,\n\n          structure:\n            collect(text),\n        };\n      }\n    );\n\n  const allCanEarlyReturn =\n    routes.every(\n      route =>\n        route.canInsertEarlyNoWriteGuard\n    );\n\n  const recommendedSurface =\n    allCanEarlyReturn\n      ? \"AUTHENTICATED_REQUEST_MODE_EARLY_RETURN_BEFORE_WRITE_ORDER_BOUNDARY\"\n      : \"DO_NOT_PATCH_UNTIL_ROUTE_CONTROL_FLOW_IS_RESOLVED\";\n\n  const report = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_NO_WRITE_ROUTE_DESIGN_PROBE_V1_COMPLETE\",\n\n    recommendedSurface,\n\n    routes,\n\n    safety: {\n      readOnly:\n        true,\n\n      routeCalled:\n        false,\n\n      networkCalls:\n        0,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      realTradingEnabled:\n        false,\n    },\n\n    nextGate:\n      allCanEarlyReturn\n        ? \"IMPLEMENT_EXPLICIT_AUTHENTICATED_NO_WRITE_ONE_SHOT_SMOKE_SURFACE_V1\"\n        : \"INSPECT_ROUTE_CONTROL_FLOW_BEFORE_PATCHING\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\"\n    ),\n    {\n      recursive: true,\n    }\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-no-write-route-design-probe-v1.json\"\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2\n    ),\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        recommendedSurface:\n          report.recommendedSurface,\n\n        routes:\n          routes.map(\n            route => ({\n              file:\n                route.file,\n\n              postFound:\n                route.postFound,\n\n              requestJsonFound:\n                route.requestJsonFound,\n\n              authFound:\n                route.authFound,\n\n              writeOrOrderFound:\n                route.writeOrOrderFound,\n\n              authBeforeWrite:\n                route.authBeforeWrite,\n\n              jsonBeforeWrite:\n                route.jsonBeforeWrite,\n\n              canInsertEarlyNoWriteGuard:\n                route.canInsertEarlyNoWriteGuard,\n            })\n          ),\n\n        nextGate:\n          report.nextGate,\n      },\n      null,\n      2\n    )\n  );\n\n  process.exitCode = 0;\n}\n",
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
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-no-write-route-design"
    ] =
      "node ./scripts/true-forward-oos-no-write-route-design-probe-v1.cjs";

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_NO_WRITE_ROUTE_DESIGN_PROBE_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-no-write-route-design-probe-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-no-write-route-design",

          mode:
            "READ_ONLY_ROUTE_CONTROL_FLOW_PROBE",

          safety: {
            routeCalled:
              false,

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
            "RUN_COMPACT_NO_WRITE_ROUTE_DESIGN_PROBE",
        },
        null,
        2
      )
    );
  }
}
