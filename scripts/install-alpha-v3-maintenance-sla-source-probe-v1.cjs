const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-maintenance-sla-source-probe.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  \"app/api/trading/automation/run/route.ts\",\n  \"app/api/orders/paper/execute/route.ts\",\n  \"app/api/orders/paper/execute-approved/route.ts\",\n  \"lib/trading/execute-approved-paper-orders.ts\",\n  \"lib/trading/execute-paper-order.ts\",\n  \"app/components/AutomationRunPanel.tsx\",\n  \"app/page.tsx\",\n];\n\nconst reportFile =\n  path.resolve(\n    root,\n    \"logs/alpha-v3-maintenance-sla-source-probe.json\"\n  );\n\nfunction read(rel) {\n  const file = path.resolve(root, rel);\n\n  if (!fs.existsSync(file)) {\n    return {\n      file: rel,\n      exists: false,\n      text: null,\n    };\n  }\n\n  return {\n    file: rel,\n    exists: true,\n    text: fs.readFileSync(file, \"utf8\"),\n  };\n}\n\nfunction snippets(text, regex, radius = 5, max = 30) {\n  if (!text) {\n    return [];\n  }\n\n  const normalized =\n    text.replace(/\\r\\n/g, \"\\n\");\n\n  const lines =\n    normalized.split(\"\\n\");\n\n  const rows = [];\n  let match;\n\n  while (\n    (match = regex.exec(normalized)) &&\n    rows.length < max\n  ) {\n    const line =\n      normalized\n        .slice(0, match.index)\n        .split(\"\\n\")\n        .length;\n\n    const start =\n      Math.max(\n        1,\n        line - radius\n      );\n\n    const end =\n      Math.min(\n        lines.length,\n        line + radius\n      );\n\n    rows.push({\n      match:\n        match[0],\n\n      line,\n\n      snippet:\n        lines\n          .slice(\n            start - 1,\n            end\n          )\n          .map(\n            (value, offset) =>\n              `${start + offset}: ${value}`\n          )\n          .join(\"\\n\"),\n    });\n  }\n\n  return rows;\n}\n\nfunction numbersFromText(text) {\n  if (!text) {\n    return [];\n  }\n\n  const patterns = [\n    {\n      kind: \"setIntervalMs\",\n      regex: /setInterval\\s*\\([\\s\\S]{0,500}?,\\s*(\\d[\\d_]*)\\s*\\)/gi,\n      scale: 1,\n    },\n    {\n      kind: \"setTimeoutMs\",\n      regex: /setTimeout\\s*\\([\\s\\S]{0,500}?,\\s*(\\d[\\d_]*)\\s*\\)/gi,\n      scale: 1,\n    },\n    {\n      kind: \"pollMinutes\",\n      regex: /\\bpoll(?:ing)?Minutes?\\b\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)/gi,\n      scale: 60000,\n    },\n    {\n      kind: \"intervalMinutes\",\n      regex: /\\bintervalMinutes?\\b\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)/gi,\n      scale: 60000,\n    },\n    {\n      kind: \"pollSeconds\",\n      regex: /\\bpoll(?:ing)?Seconds?\\b\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)/gi,\n      scale: 1000,\n    },\n    {\n      kind: \"intervalSeconds\",\n      regex: /\\bintervalSeconds?\\b\\s*[:=]\\s*(\\d+(?:\\.\\d+)?)/gi,\n      scale: 1000,\n    },\n  ];\n\n  const rows = [];\n\n  for (const spec of patterns) {\n    let match;\n\n    while (\n      (match = spec.regex.exec(text))\n    ) {\n      const raw =\n        String(match[1])\n          .replace(/_/g, \"\");\n\n      const number =\n        Number(raw);\n\n      if (\n        Number.isFinite(number) &&\n        number > 0\n      ) {\n        rows.push({\n          kind:\n            spec.kind,\n\n          raw:\n            match[0],\n\n          value:\n            number,\n\n          milliseconds:\n            number *\n            spec.scale,\n        });\n      }\n    }\n  }\n\n  return rows;\n}\n\nconst files =\n  targets.map(read);\n\nconst evidence =\n  files.map((row) => {\n    const text = row.text;\n\n    return {\n      file:\n        row.file,\n\n      exists:\n        row.exists,\n\n      cadence:\n        snippets(\n          text,\n          /\\b(setInterval|setTimeout|poll(?:ing)?Minutes?|poll(?:ing)?Seconds?|intervalMinutes?|intervalSeconds?|cron|schedule|AUTOMATION|POLL)\\b/gi,\n          6,\n          30\n        ),\n\n      approvedSelection:\n        snippets(\n          text,\n          /RISK_APPROVED|paper_order_requests|executeApprovedPaperOrders|executePaperOrder|execute_paper_buy_order/gi,\n          7,\n          40\n        ),\n\n      batchAndLimit:\n        snippets(\n          text,\n          /\\.limit\\s*\\(|batchSize|batch_size|maxOrders|max_orders|concurrency|Promise\\.all|Promise\\.allSettled/gi,\n          5,\n          30\n        ),\n\n      retryAndError:\n        snippets(\n          text,\n          /\\bretry\\b|\\bretries\\b|FAILED|CANCELLED|CANCELED|EXPIRED|catch\\s*\\(|throw\\s+new\\s+Error/gi,\n          5,\n          30\n        ),\n\n      timeFilters:\n        snippets(\n          text,\n          /created_at|updated_at|reserved_risk_at|expires?_at|older|stale|timeout/gi,\n          6,\n          30\n        ),\n\n      numericCadenceCandidates:\n        numbersFromText(text),\n    };\n  });\n\nconst allCadenceNumbers =\n  evidence.flatMap(\n    (row) =>\n      row.numericCadenceCandidates.map(\n        (candidate) => ({\n          file: row.file,\n          ...candidate,\n        })\n      )\n  );\n\nconst explicitCadenceMs =\n  allCadenceNumbers\n    .map(\n      (row) =>\n        row.milliseconds\n    )\n    .filter(\n      (value) =>\n        Number.isFinite(value) &&\n        value >= 1000 &&\n        value <= 60 * 60 * 1000\n    );\n\nconst maxExplicitCadenceMs =\n  explicitCadenceMs.length\n    ? Math.max(\n        ...explicitCadenceMs\n      )\n    : null;\n\nconst executorPresent =\n  evidence.some(\n    (row) =>\n      row.approvedSelection.some(\n        (hit) =>\n          /RISK_APPROVED|executeApprovedPaperOrders/i.test(\n            hit.match +\n            \"\\n\" +\n            hit.snippet\n          )\n      )\n  );\n\nconst hasTimeBasedApprovedFilter =\n  evidence.some(\n    (row) =>\n      row.timeFilters.some(\n        (hit) =>\n          /reserved_risk_at|created_at|expires?_at|stale|older|timeout/i.test(\n            hit.match +\n            \"\\n\" +\n            hit.snippet\n          )\n      )\n  );\n\nlet recommendation;\n\nif (maxExplicitCadenceMs != null) {\n  const recommendedMs =\n    Math.max(\n      2 * 60 * 1000,\n      maxExplicitCadenceMs * 3\n    );\n\n  const cappedMs =\n    Math.min(\n      recommendedMs,\n      15 * 60 * 1000\n    );\n\n  recommendation = {\n    evidenceSufficient:\n      true,\n\n    basis:\n      \"MAX_EXPLICIT_EXECUTION_OR_AUTOMATION_CADENCE_X3_WITH_MIN_2M_AND_MAX_15M\",\n\n    maxExplicitCadenceMs,\n\n    recommendedStaleAfterMs:\n      cappedMs,\n\n    recommendedStaleAfterSeconds:\n      Math.round(\n        cappedMs / 1000\n      ),\n\n    recommendedStaleAfterMinutes:\n      Number(\n        (\n          cappedMs /\n          60000\n        ).toFixed(2)\n      ),\n  };\n} else {\n  recommendation = {\n    evidenceSufficient:\n      false,\n\n    basis:\n      \"NO_RELIABLE_EXPLICIT_EXECUTION_CADENCE_FOUND\",\n\n    maxExplicitCadenceMs:\n      null,\n\n    recommendedStaleAfterMs:\n      null,\n\n    recommendedStaleAfterSeconds:\n      null,\n\n    recommendedStaleAfterMinutes:\n      null,\n  };\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_MAINTENANCE_SLA_SOURCE_PROBE_COMPLETE\",\n\n  files:\n    evidence,\n\n  summary: {\n    executorPresent,\n\n    explicitCadenceCandidates:\n      allCadenceNumbers,\n\n    hasTimeBasedApprovedFilter,\n\n    recommendation,\n  },\n\n  decision: {\n    safeToIntegrateMaintenanceCaller:\n      executorPresent &&\n      recommendation.evidenceSufficient,\n\n    nextGate:\n      executorPresent &&\n      recommendation.evidenceSufficient\n        ? \"BUILD_MAINTENANCE_CALLER_WITH_EVIDENCE_BASED_EXPIRY_SLA\"\n        : \"REVIEW_AUTOMATION_EXECUTION_CADENCE_BEFORE_CHOOSING_SLA\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    ordersChanged: 0,\n    positionsChanged: 0,\n  },\n\n  outputFile:\n    \"logs/alpha-v3-maintenance-sla-source-probe.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(reportFile),\n  {\n    recursive: true,\n  }\n);\n\nfs.writeFileSync(\n  reportFile,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      files:\n        report.files.map(\n          (row) => ({\n            file:\n              row.file,\n\n            exists:\n              row.exists,\n\n            cadenceHits:\n              row.cadence.length,\n\n            approvedSelectionHits:\n              row.approvedSelection.length,\n\n            batchAndLimitHits:\n              row.batchAndLimit.length,\n\n            retryAndErrorHits:\n              row.retryAndError.length,\n\n            timeFilterHits:\n              row.timeFilters.length,\n\n            numericCadenceCandidates:\n              row.numericCadenceCandidates,\n          })\n        ),\n\n      summary:\n        report.summary,\n\n      databaseWrites:\n        0,\n\n      nextGate:\n        report.decision.nextGate,\n\n      outputFile:\n        report.outputFile,\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_MAINTENANCE_SLA_SOURCE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-maintenance-sla-source-probe.cjs",

      targets: [
        "app/api/trading/automation/run/route.ts",
        "app/api/orders/paper/execute/route.ts",
        "app/api/orders/paper/execute-approved/route.ts",
        "lib/trading/execute-approved-paper-orders.ts",
        "lib/trading/execute-paper-order.ts",
        "app/components/AutomationRunPanel.tsx",
        "app/page.tsx"
      ],

      databaseWrites:
        0,

      nextAction:
        "RUN_MAINTENANCE_SLA_SOURCE_PROBE"
    },
    null,
    2
  )
);
