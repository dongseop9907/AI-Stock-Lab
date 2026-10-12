const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-auto-order-semantics-probe.cjs"
  );

fs.mkdirSync(
  path.dirname(
    target
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst automationRel =\n  \"app/api/trading/automation/run/route.ts\";\n\nconst panelRel =\n  \"app/components/AutomationRunPanel.tsx\";\n\nconst automationFile =\n  path.resolve(\n    root,\n    automationRel\n  );\n\nconst panelFile =\n  path.resolve(\n    root,\n    panelRel\n  );\n\nconst outputFile =\n  path.resolve(\n    root,\n    \"logs/alpha-v3-auto-order-semantics-probe.json\"\n  );\n\nif (!fs.existsSync(automationFile)) {\n  throw new Error(\n    \"AUTOMATION_RUN_ROUTE_NOT_FOUND\"\n  );\n}\n\nconst automation =\n  fs.readFileSync(\n    automationFile,\n    \"utf8\"\n  );\n\nconst panel =\n  fs.existsSync(panelFile)\n    ? fs.readFileSync(\n        panelFile,\n        \"utf8\"\n      )\n    : \"\";\n\nconst lines =\n  automation\n    .replace(/\\r\\n/g, \"\\n\")\n    .split(\"\\n\");\n\nfunction excerptAroundLine(\n  line,\n  radius = 14\n) {\n  const start =\n    Math.max(\n      1,\n      line - radius\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      line + radius\n    );\n\n  return {\n    startLine:\n      start,\n\n    endLine:\n      end,\n\n    text:\n      lines\n        .slice(\n          start - 1,\n          end\n        )\n        .map(\n          (value, index) =>\n            `${start + index}: ${value}`\n        )\n        .join(\"\\n\"),\n  };\n}\n\nfunction findAll(\n  regex,\n  text = automation\n) {\n  const rows = [];\n\n  for (\n    const match of\n      text.matchAll(regex)\n  ) {\n    const index =\n      match.index ?? -1;\n\n    const line =\n      index >= 0\n        ? text\n            .slice(0, index)\n            .split(/\\r?\\n/)\n            .length\n        : null;\n\n    rows.push({\n      line,\n      match:\n        match[0],\n    });\n  }\n\n  return rows;\n}\n\nconst autoOrderHits =\n  findAll(\n    /\\bautoOrder\\b/g\n  );\n\nconst paperOrderHits =\n  findAll(\n    /\\/api\\/orders\\/paper|createPaperBuyOrder|paperOrderEnabled/g\n  );\n\nconst requestParsingHits =\n  findAll(\n    /JSON\\.parse\\s*\\(|request\\.(?:json|text)\\s*\\(|triggerType|includeMarketSync|maxOrders|autoOrder/g\n  );\n\nconst keyLines =\n  Array.from(\n    new Set(\n      [\n        ...autoOrderHits,\n        ...paperOrderHits,\n        ...requestParsingHits,\n      ]\n        .map(\n          (row) =>\n            row.line\n        )\n        .filter(\n          (line) =>\n            Number.isInteger(line)\n        )\n    )\n  )\n    .sort(\n      (a, b) =>\n        a - b\n    );\n\nconst excerpts =\n  keyLines.map(\n    (line) => ({\n      line,\n      excerpt:\n        excerptAroundLine(\n          line,\n          10\n        ),\n    })\n  );\n\nconst autoOrderFalseGuards =\n  findAll(\n    /if\\s*\\(\\s*!?\\s*autoOrder\\s*\\)|autoOrder\\s*\\?\\s*|autoOrder\\s*&&|!\\s*autoOrder\\s*\\?/g\n  );\n\nconst autoOrderAssignments =\n  findAll(\n    /(?:const|let)\\s+autoOrder[\\s\\S]{0,220}?;/g\n  );\n\nconst autoOrderDefaultFalse =\n  /autoOrder[\\s\\S]{0,180}?(?:===\\s*true|\\?\\?\\s*false|Boolean\\s*\\()/m.test(\n    automation\n  );\n\nconst explicitOrderPathIndex =\n  automation.indexOf(\n    \"/api/orders/paper\"\n  );\n\nconst autoOrderBeforeOrderPath =\n  autoOrderHits.some(\n    (row) => {\n      if (\n        row.line == null ||\n        explicitOrderPathIndex < 0\n      ) {\n        return false;\n      }\n\n      const hitIndex =\n        automation.indexOf(\n          \"autoOrder\",\n          automation\n            .split(/\\r?\\n/)\n            .slice(\n              0,\n              row.line - 1\n            )\n            .join(\"\\n\")\n            .length\n        );\n\n      return (\n        hitIndex >= 0 &&\n        hitIndex <\n          explicitOrderPathIndex\n      );\n    }\n  );\n\nconst orderPathContext =\n  explicitOrderPathIndex >= 0\n    ? excerptAroundLine(\n        automation\n          .slice(\n            0,\n            explicitOrderPathIndex\n          )\n          .split(/\\r?\\n/)\n          .length,\n        26\n      )\n    : null;\n\nconst panelAutoOrderHits =\n  findAll(\n    /\\bautoOrder\\b/g,\n    panel\n  );\n\nconst panelDefaultsAutoOrder =\n  /useState\\s*\\(\\s*(?:true|false)\\s*\\)/.test(\n    panel\n  );\n\nconst report = {\n  status:\n    \"ALPHA_V3_AUTO_ORDER_SEMANTICS_PROBE_COMPLETE\",\n\n  files: {\n    automationRun: {\n      file:\n        automationRel,\n      lineCount:\n        lines.length,\n    },\n\n    automationPanel: {\n      file:\n        panelRel,\n      exists:\n        fs.existsSync(panelFile),\n      lineCount:\n        panel\n          ? panel\n              .split(/\\r?\\n/)\n              .length\n          : 0,\n    },\n  },\n\n  findings: {\n    autoOrderHitCount:\n      autoOrderHits.length,\n\n    paperOrderSurfaceHitCount:\n      paperOrderHits.length,\n\n    autoOrderAssignments,\n\n    autoOrderFalseGuards,\n\n    autoOrderDefaultFalse,\n\n    explicitPaperOrderPathPresent:\n      explicitOrderPathIndex >= 0,\n\n    autoOrderAppearsBeforePaperOrderPath:\n      autoOrderBeforeOrderPath,\n\n    panelAutoOrderHitCount:\n      panelAutoOrderHits.length,\n\n    panelDefaultsAutoOrder,\n\n    orderPathContext,\n\n    excerpts,\n  },\n\n  decision: {\n    autoOrderFalseCanBeCertifiedFromSource:\n      (\n        autoOrderFalseGuards.length > 0 &&\n        explicitOrderPathIndex >= 0\n      ),\n\n    nextGate:\n      (\n        autoOrderFalseGuards.length > 0 &&\n        explicitOrderPathIndex >= 0\n      )\n        ? \"BUILD_AUTO_ORDER_FALSE_ONE_SHOT_SMOKE_TEST\"\n        : \"PATCH_AUTOMATION_RUN_WITH_EXPLICIT_NO_ORDER_MODE\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    cyclePostRequests: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n  },\n\n  outputFile:\n    \"logs/alpha-v3-auto-order-semantics-probe.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(\n    outputFile\n  ),\n  {\n    recursive: true,\n  }\n);\n\nfs.writeFileSync(\n  outputFile,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    report,\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_AUTO_ORDER_SEMANTICS_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-auto-order-semantics-probe.cjs",

      checks: [
        "AUTO_ORDER_REQUEST_PARSING",
        "AUTO_ORDER_DEFAULT",
        "AUTO_ORDER_FALSE_GUARDS",
        "PAPER_ORDER_ENDPOINT_GATING",
        "AUTOMATION_PANEL_AUTO_ORDER_BEHAVIOR"
      ],

      databaseReads: 0,
      databaseWrites: 0,
      networkCalls: 0,
      cyclePostRequests: 0,
      ordersCreated: 0,
      positionsChanged: 0,

      nextAction:
        "RUN_AUTO_ORDER_SEMANTICS_PROBE"
    },
    null,
    2
  )
);
