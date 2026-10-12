const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGETS = [
  "app/api/trading/automation/cycle/route.ts",
  "app/api/trading/automation/run/route.ts",
];

function read(rel) {
  return fs.readFileSync(
    path.join(ROOT, rel),
    "utf8"
  );
}

function collect(text) {
  const lines =
    text.split(/\r?\n/);

  const hits = [];

  const patterns = [
    /export\s+(?:async\s+)?function\s+POST/,
    /request\.json\s*\(/,
    /\.json\s*\(/,
    /TRADING_AUTOMATION_SECRET/,
    /authorization/i,
    /bearer/i,
    /create.*order/i,
    /place.*order/i,
    /submit.*order/i,
    /paper.*order/i,
    /order.*service/i,
    /\.(insert|update|upsert|delete)\s*\(/i,
    /createSupabaseServerClient/,
    /runAutomation/i,
    /run.*Cycle/i,
    /run.*Trading/i,
    /return\s+NextResponse\.json/,
    /NextResponse\.json/,
    /dry.?run/i,
    /preview/i,
    /smoke/i,
  ];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      patterns.some(
        re => re.test(lines[i])
      )
    ) {
      const start =
        Math.max(
          0,
          i - 3
        );

      const end =
        Math.min(
          lines.length,
          i + 7
        );

      hits.push({
        anchorLine:
          i + 1,

        snippet:
          lines
            .slice(start, end)
            .map(
              (line, offset) => ({
                line:
                  start + offset + 1,

                text:
                  line,
              })
            ),
      });
    }
  }

  return hits.slice(0, 50);
}

const missing =
  TARGETS.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (
  missing.length > 0
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_NO_WRITE_ROUTE_DESIGN_PROBE_V1_FAILED",

        reason:
          "REQUIRED_ROUTE_FILES_MISSING",

        missing,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
} else {
  const routes =
    TARGETS.map(
      rel => {
        const text =
          read(rel);

        const postIndex =
          text.search(
            /export\s+(?:async\s+)?function\s+POST/
          );

        const firstWriteIndex =
          text.search(
            /\.(insert|update|upsert|delete)\s*\(|create.*order|place.*order|submit.*order|paper.*order|order.*service/i
          );

        const authIndex =
          text.search(
            /TRADING_AUTOMATION_SECRET|authorization|bearer/i
          );

        const jsonIndex =
          text.search(
            /request\.json\s*\(|\.json\s*\(/i
          );

        return {
          file:
            rel,

          postFound:
            postIndex >= 0,

          requestJsonFound:
            jsonIndex >= 0,

          authFound:
            authIndex >= 0,

          writeOrOrderFound:
            firstWriteIndex >= 0,

          authBeforeWrite:
            authIndex >= 0 &&
            firstWriteIndex >= 0 &&
            authIndex <
              firstWriteIndex,

          jsonBeforeWrite:
            jsonIndex >= 0 &&
            firstWriteIndex >= 0 &&
            jsonIndex <
              firstWriteIndex,

          canInsertEarlyNoWriteGuard:
            postIndex >= 0 &&
            firstWriteIndex >= 0,

          structure:
            collect(text),
        };
      }
    );

  const allCanEarlyReturn =
    routes.every(
      route =>
        route.canInsertEarlyNoWriteGuard
    );

  const recommendedSurface =
    allCanEarlyReturn
      ? "AUTHENTICATED_REQUEST_MODE_EARLY_RETURN_BEFORE_WRITE_ORDER_BOUNDARY"
      : "DO_NOT_PATCH_UNTIL_ROUTE_CONTROL_FLOW_IS_RESOLVED";

  const report = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_NO_WRITE_ROUTE_DESIGN_PROBE_V1_COMPLETE",

    recommendedSurface,

    routes,

    safety: {
      readOnly:
        true,

      routeCalled:
        false,

      networkCalls:
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
      allCanEarlyReturn
        ? "IMPLEMENT_EXPLICIT_AUTHENTICATED_NO_WRITE_ONE_SHOT_SMOKE_SURFACE_V1"
        : "INSPECT_ROUTE_CONTROL_FLOW_BEFORE_PATCHING",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs"
    ),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-no-write-route-design-probe-v1.json"
    ),
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        recommendedSurface:
          report.recommendedSurface,

        routes:
          routes.map(
            route => ({
              file:
                route.file,

              postFound:
                route.postFound,

              requestJsonFound:
                route.requestJsonFound,

              authFound:
                route.authFound,

              writeOrOrderFound:
                route.writeOrOrderFound,

              authBeforeWrite:
                route.authBeforeWrite,

              jsonBeforeWrite:
                route.jsonBeforeWrite,

              canInsertEarlyNoWriteGuard:
                route.canInsertEarlyNoWriteGuard,
            })
          ),

        nextGate:
          report.nextGate,
      },
      null,
      2
    )
  );

  process.exitCode = 0;
}
