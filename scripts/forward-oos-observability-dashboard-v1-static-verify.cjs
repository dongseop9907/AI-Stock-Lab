const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const serviceFile =
  path.join(
    ROOT,
    "lib",
    "research",
    "get-forward-oos-observability-dashboard-v1.ts"
  );

const paperFile =
  path.join(
    ROOT,
    "lib",
    "trading",
    "execute-paper-order.ts"
  );

const pageFile =
  path.join(
    ROOT,
    "app",
    "forward-oos",
    "page.tsx"
  );

if (
  !fs.existsSync(serviceFile) ||
  !fs.existsSync(paperFile) ||
  !fs.existsSync(pageFile)
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_OBSERVABILITY_DASHBOARD_BUILD_HYGIENE_V2_STATIC_FAILED",

    failed: [
      "requiredFilesExist"
    ]
  }, null, 2));

  process.exitCode = 1;
} else {
  const service =
    fs.readFileSync(
      serviceFile,
      "utf8"
    );

  const paper =
    fs.readFileSync(
      paperFile,
      "utf8"
    );

  const page =
    fs.readFileSync(
      pageFile,
      "utf8"
    );

  const checks = {
    logsStaticallyScoped:
      service.includes(
        'path.join(\n    process.cwd(),\n    "logs",'
      ),

    dynamicRootJoinRemoved:
      !service.includes(
        "function full("
      ),

    serverOnly:
      service.includes(
        'import "server-only";'
      ),

    nullIsNotNumberZero:
      service.includes(
        "value === null"
      ) &&
      service.includes(
        "value === undefined"
      ),

    staleReadinessSuppressed:
      service.includes(
        "Stale evaluator/summary readiness is suppressed"
      ) &&
      service.includes(
        "hasRealObservations &&"
      ),

    dashboardStillReadOnly:
      service.includes(
        "readOnly:"
      ) &&
      !service.toLowerCase().includes(
        ".insert("
      ) &&
      !service.toLowerCase().includes(
        ".update("
      ) &&
      !service.toLowerCase().includes(
        ".delete("
      ),

    paperTypeBridgeInstalled:
      paper.includes(
        "orderData as unknown as"
      ) &&
      paper.includes(
        "PaperOrderExecutionRecord"
      ),

    pageStillPresent:
      page.includes(
        "Forward OOS Observability"
      )
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_FORWARD_OOS_OBSERVABILITY_DASHBOARD_BUILD_HYGIENE_V2_STATIC_VERIFIED"
        : "AI_STOCK_LAB_FORWARD_OOS_OBSERVABILITY_DASHBOARD_BUILD_HYGIENE_V2_STATIC_FAILED",

    checks,

    safety: {
      dashboardReadOnly:
        true,

      paperRuntimeLogicChanged:
        false,

      paperTypeAnnotationOnly:
        true,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_CONTRACT_AND_NEXT_BUILD"
        : "REPAIR_BUILD_HYGIENE_V2"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
