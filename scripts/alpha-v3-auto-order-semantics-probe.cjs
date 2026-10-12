const fs = require("fs");
const path = require("path");

const root = process.cwd();

const automationRel =
  "app/api/trading/automation/run/route.ts";

const panelRel =
  "app/components/AutomationRunPanel.tsx";

const automationFile =
  path.resolve(
    root,
    automationRel
  );

const panelFile =
  path.resolve(
    root,
    panelRel
  );

const outputFile =
  path.resolve(
    root,
    "logs/alpha-v3-auto-order-semantics-probe.json"
  );

if (!fs.existsSync(automationFile)) {
  throw new Error(
    "AUTOMATION_RUN_ROUTE_NOT_FOUND"
  );
}

const automation =
  fs.readFileSync(
    automationFile,
    "utf8"
  );

const panel =
  fs.existsSync(panelFile)
    ? fs.readFileSync(
        panelFile,
        "utf8"
      )
    : "";

const lines =
  automation
    .replace(/\r\n/g, "\n")
    .split("\n");

function excerptAroundLine(
  line,
  radius = 14
) {
  const start =
    Math.max(
      1,
      line - radius
    );

  const end =
    Math.min(
      lines.length,
      line + radius
    );

  return {
    startLine:
      start,

    endLine:
      end,

    text:
      lines
        .slice(
          start - 1,
          end
        )
        .map(
          (value, index) =>
            `${start + index}: ${value}`
        )
        .join("\n"),
  };
}

function findAll(
  regex,
  text = automation
) {
  const rows = [];

  for (
    const match of
      text.matchAll(regex)
  ) {
    const index =
      match.index ?? -1;

    const line =
      index >= 0
        ? text
            .slice(0, index)
            .split(/\r?\n/)
            .length
        : null;

    rows.push({
      line,
      match:
        match[0],
    });
  }

  return rows;
}

const autoOrderHits =
  findAll(
    /\bautoOrder\b/g
  );

const paperOrderHits =
  findAll(
    /\/api\/orders\/paper|createPaperBuyOrder|paperOrderEnabled/g
  );

const requestParsingHits =
  findAll(
    /JSON\.parse\s*\(|request\.(?:json|text)\s*\(|triggerType|includeMarketSync|maxOrders|autoOrder/g
  );

const keyLines =
  Array.from(
    new Set(
      [
        ...autoOrderHits,
        ...paperOrderHits,
        ...requestParsingHits,
      ]
        .map(
          (row) =>
            row.line
        )
        .filter(
          (line) =>
            Number.isInteger(line)
        )
    )
  )
    .sort(
      (a, b) =>
        a - b
    );

const excerpts =
  keyLines.map(
    (line) => ({
      line,
      excerpt:
        excerptAroundLine(
          line,
          10
        ),
    })
  );

const autoOrderFalseGuards =
  findAll(
    /if\s*\(\s*!?\s*autoOrder\s*\)|autoOrder\s*\?\s*|autoOrder\s*&&|!\s*autoOrder\s*\?/g
  );

const autoOrderAssignments =
  findAll(
    /(?:const|let)\s+autoOrder[\s\S]{0,220}?;/g
  );

const autoOrderDefaultFalse =
  /autoOrder[\s\S]{0,180}?(?:===\s*true|\?\?\s*false|Boolean\s*\()/m.test(
    automation
  );

const explicitOrderPathIndex =
  automation.indexOf(
    "/api/orders/paper"
  );

const autoOrderBeforeOrderPath =
  autoOrderHits.some(
    (row) => {
      if (
        row.line == null ||
        explicitOrderPathIndex < 0
      ) {
        return false;
      }

      const hitIndex =
        automation.indexOf(
          "autoOrder",
          automation
            .split(/\r?\n/)
            .slice(
              0,
              row.line - 1
            )
            .join("\n")
            .length
        );

      return (
        hitIndex >= 0 &&
        hitIndex <
          explicitOrderPathIndex
      );
    }
  );

const orderPathContext =
  explicitOrderPathIndex >= 0
    ? excerptAroundLine(
        automation
          .slice(
            0,
            explicitOrderPathIndex
          )
          .split(/\r?\n/)
          .length,
        26
      )
    : null;

const panelAutoOrderHits =
  findAll(
    /\bautoOrder\b/g,
    panel
  );

const panelDefaultsAutoOrder =
  /useState\s*\(\s*(?:true|false)\s*\)/.test(
    panel
  );

const report = {
  status:
    "ALPHA_V3_AUTO_ORDER_SEMANTICS_PROBE_COMPLETE",

  files: {
    automationRun: {
      file:
        automationRel,
      lineCount:
        lines.length,
    },

    automationPanel: {
      file:
        panelRel,
      exists:
        fs.existsSync(panelFile),
      lineCount:
        panel
          ? panel
              .split(/\r?\n/)
              .length
          : 0,
    },
  },

  findings: {
    autoOrderHitCount:
      autoOrderHits.length,

    paperOrderSurfaceHitCount:
      paperOrderHits.length,

    autoOrderAssignments,

    autoOrderFalseGuards,

    autoOrderDefaultFalse,

    explicitPaperOrderPathPresent:
      explicitOrderPathIndex >= 0,

    autoOrderAppearsBeforePaperOrderPath:
      autoOrderBeforeOrderPath,

    panelAutoOrderHitCount:
      panelAutoOrderHits.length,

    panelDefaultsAutoOrder,

    orderPathContext,

    excerpts,
  },

  decision: {
    autoOrderFalseCanBeCertifiedFromSource:
      (
        autoOrderFalseGuards.length > 0 &&
        explicitOrderPathIndex >= 0
      ),

    nextGate:
      (
        autoOrderFalseGuards.length > 0 &&
        explicitOrderPathIndex >= 0
      )
        ? "BUILD_AUTO_ORDER_FALSE_ONE_SHOT_SMOKE_TEST"
        : "PATCH_AUTOMATION_RUN_WITH_EXPLICIT_NO_ORDER_MODE",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    cyclePostRequests: 0,
    ordersCreated: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-auto-order-semantics-probe.json",
};

fs.mkdirSync(
  path.dirname(
    outputFile
  ),
  {
    recursive: true,
  }
);

fs.writeFileSync(
  outputFile,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);
