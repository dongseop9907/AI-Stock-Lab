const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SERVICE = path.join(
  ROOT,
  "lib",
  "research",
  "get-forward-oos-observability-dashboard-v1.ts"
);

const PAPER = path.join(
  ROOT,
  "lib",
  "trading",
  "execute-paper-order.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_DASHBOARD_BUILD_HYGIENE_V3_PROBE_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

for (const required of [SERVICE, PAPER]) {
  if (!fs.existsSync(required)) {
    fail(
      "REQUIRED_FILE_MISSING",
      { required }
    );
    return;
  }
}

let service =
  fs.readFileSync(
    SERVICE,
    "utf8"
  );

const serviceBefore =
  service;

service =
  service.replace(
    'import "server-only";\n\n',
    ""
  );

service =
  service.replace(
    "path.join(\n    process.cwd(),\n    \"logs\",\n  )",
    "path.join(\n    /* turbopackIgnore: true */ process.cwd(),\n    \"logs\",\n  )"
  );

if (service === serviceBefore) {
  const hasServerOnly =
    service.includes(
      'import "server-only";'
    );

  const hasIgnore =
    service.includes(
      "turbopackIgnore: true"
    );

  if (
    hasServerOnly ||
    !hasIgnore
  ) {
    fail(
      "SERVICE_REPAIR_PATTERN_NOT_APPLIED",
      {
        hasServerOnly,
        hasIgnore,
      }
    );
    return;
  }
}

fs.mkdirSync(
  path.join(
    ROOT,
    "scripts",
    "backups"
  ),
  {
    recursive: true
  }
);

const serviceBackup =
  path.join(
    ROOT,
    "scripts",
    "backups",
    "get-forward-oos-observability-dashboard-v1.before-build-hygiene-v3.ts"
  );

if (!fs.existsSync(serviceBackup)) {
  fs.copyFileSync(
    SERVICE,
    serviceBackup
  );
}

fs.writeFileSync(
  SERVICE,
  service,
  "utf8"
);

const paper =
  fs.readFileSync(
    PAPER,
    "utf8"
  );

const lines =
  paper.split(/\r?\n/);

function snippet(
  start,
  end
) {
  return lines
    .slice(
      Math.max(
        0,
        start - 1
      ),
      Math.min(
        lines.length,
        end
      )
    )
    .map(
      (text, index) => ({
        line:
          Math.max(
            1,
            start
          ) +
          index,

        text
      })
    );
}

const observedAtMatches = [];

for (
  let i = 0;
  i < lines.length;
  i++
) {
  if (
    lines[i].includes(
      "executionPriceObservedAt"
    ) ||
    lines[i].includes(
      "observedAt:"
    )
  ) {
    observedAtMatches.push({
      line:
        i + 1,

      snippet:
        snippet(
          i - 8,
          i + 12
        ),
    });
  }
}

const safeExecutionMatches = [];

for (
  let i = 0;
  i < lines.length;
  i++
) {
  if (
    lines[i].includes(
      "safeExecution"
    )
  ) {
    safeExecutionMatches.push({
      line:
        i + 1,

      snippet:
        snippet(
          i - 10,
          i + 16
        ),
    });
  }
}

const functionHints = [];

for (
  let i = 0;
  i < lines.length;
  i++
) {
  if (
    lines[i].includes(
      "load"
    ) ||
    lines[i].includes(
      "fetch"
    ) ||
    lines[i].includes(
      "quote"
    ) ||
    lines[i].includes(
      "price"
    )
  ) {
    if (
      lines[i].includes(
        "observedAt"
      ) ||
      lines[i].includes(
        "ObservedAt"
      ) ||
      lines[i].includes(
        "executionPrice"
      )
    ) {
      functionHints.push({
        line:
          i + 1,

        snippet:
          snippet(
            i - 12,
            i + 20
          ),
      });
    }
  }
}

const report = {
  status:
    "AI_STOCK_LAB_FORWARD_OOS_DASHBOARD_BUILD_HYGIENE_V3_PROBE_COMPLETE",

  serviceRepair: {
    serverOnlyRemoved:
      !service.includes(
        'import "server-only";'
      ),

    turbopackIgnoreAdded:
      service.includes(
        "turbopackIgnore: true"
      ),

    runtimeLogicChanged:
      false,
  },

  paperTypeIssue: {
    target:
      "safeExecution.executionPriceObservedAt",

    buildLine:
      519,

    observedAtMatches,
    safeExecutionMatches,
    functionHints,
  },

  safety: {
    producerExecuted:
      false,

    collectorExecuted:
      false,

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

  nextAction:
    "USE_EXACT_SOURCE_CONTEXT_TO_PATCH_nullable_executionPriceObservedAt_WITH_SEMANTICALLY_CORRECT_FALLBACK"
};

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);

process.exitCode = 0;
