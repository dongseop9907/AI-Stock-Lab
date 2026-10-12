const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-paper-order-service-type-error-probe.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targetRel =\n  \"lib/trading/paper-order-service.ts\";\n\nconst targetFile =\n  path.resolve(root, targetRel);\n\nconst reportFile =\n  path.resolve(\n    root,\n    \"logs/alpha-v3-paper-order-service-type-error-probe.json\"\n  );\n\nif (!fs.existsSync(targetFile)) {\n  throw new Error(\n    `TARGET_NOT_FOUND:${targetRel}`\n  );\n}\n\nconst text =\n  fs.readFileSync(\n    targetFile,\n    \"utf8\"\n  );\n\nconst lines =\n  text.replace(/\\r\\n/g, \"\\n\")\n    .split(\"\\n\");\n\nfunction range(start, end) {\n  return lines\n    .slice(start - 1, end)\n    .map(\n      (line, index) =>\n        `${start + index}: ${line}`\n    )\n    .join(\"\\n\");\n}\n\nfunction findAll(regex) {\n  const rows = [];\n  let match;\n\n  while (\n    (match = regex.exec(text))\n  ) {\n    const line =\n      text\n        .slice(0, match.index)\n        .split(/\\r?\\n/)\n        .length;\n\n    rows.push({\n      line,\n      match: match[0],\n    });\n  }\n\n  return rows;\n}\n\nconst identifiers = [\n  \"account\",\n  \"accountEquity\",\n  \"cashBalance\",\n  \"stock\",\n  \"entryPrice\",\n  \"decisionData\",\n  \"riskResult\",\n  \"orderError\",\n  \"createPaperBuyOrderWithCommittedRisk\",\n];\n\nconst identifierEvidence =\n  Object.fromEntries(\n    identifiers.map(\n      (name) => [\n        name,\n        findAll(\n          new RegExp(\n            `\\\\b${name}\\\\b`,\n            \"g\"\n          )\n        ),\n      ]\n    )\n  );\n\nconst functions =\n  findAll(\n    /(?:export\\s+)?(?:async\\s+)?function\\s+[A-Za-z_$][A-Za-z0-9_$]*\\s*\\(|(?:export\\s+)?const\\s+[A-Za-z_$][A-Za-z0-9_$]*\\s*=\\s*async\\s*\\(/g\n  );\n\nconst imports =\n  [\n    ...text.matchAll(\n      /import[\\s\\S]*?from\\s+[\"'][^\"']+[\"'];?/g\n    ),\n  ].map(\n    (match) => ({\n      line:\n        text\n          .slice(0, match.index)\n          .split(/\\r?\\n/)\n          .length,\n      text:\n        match[0],\n    })\n  );\n\nconst helperCallIndex =\n  text.indexOf(\n    \"createPaperBuyOrderWithCommittedRisk\"\n  );\n\nconst helperCallLine =\n  helperCallIndex >= 0\n    ? text\n        .slice(0, helperCallIndex)\n        .split(/\\r?\\n/)\n        .length\n    : null;\n\nconst report = {\n  status:\n    \"ALPHA_V3_PAPER_ORDER_SERVICE_TYPE_ERROR_PROBE_COMPLETE\",\n\n  file:\n    targetRel,\n\n  lineCount:\n    lines.length,\n\n  imports,\n\n  functions,\n\n  identifierEvidence,\n\n  focusedRanges: {\n    startTo180:\n      range(\n        1,\n        Math.min(\n          180,\n          lines.length\n        )\n      ),\n\n    helperArea:\n      helperCallLine\n        ? range(\n            Math.max(\n              1,\n              helperCallLine - 35\n            ),\n            Math.min(\n              lines.length,\n              helperCallLine + 75\n            )\n          )\n        : null,\n  },\n\n  diagnosisHints: {\n    helperCallLine,\n\n    likelyScopeBreak:\n      [\n        \"account\",\n        \"entryPrice\",\n        \"decisionData\",\n        \"riskResult\",\n        \"accountEquity\",\n        \"cashBalance\",\n        \"stock\",\n      ].some(\n        (name) =>\n          (\n            identifierEvidence[\n              name\n            ] ?? []\n          ).length > 0\n      ),\n\n    nextGate:\n      \"REPAIR_PAPER_ORDER_SERVICE_SCOPE_AND_ATOMIC_HELPER_INTEGRATION\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    filesChanged: 0,\n  },\n\n  outputFile:\n    \"logs/alpha-v3-paper-order-service-type-error-probe.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(reportFile),\n  {\n    recursive: true,\n  }\n);\n\nfs.writeFileSync(\n  reportFile,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      file:\n        report.file,\n\n      lineCount:\n        report.lineCount,\n\n      helperCallLine:\n        report.diagnosisHints\n          .helperCallLine,\n\n      imports:\n        report.imports,\n\n      functions:\n        report.functions,\n\n      identifierEvidence:\n        report.identifierEvidence,\n\n      focusedRanges:\n        report.focusedRanges,\n\n      databaseWrites:\n        0,\n\n      nextGate:\n        report.diagnosisHints\n          .nextGate,\n\n      outputFile:\n        report.outputFile,\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_PAPER_ORDER_SERVICE_TYPE_ERROR_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-paper-order-service-type-error-probe.cjs",

      target:
        "lib/trading/paper-order-service.ts",

      databaseWrites:
        0,

      filesChanged:
        0,

      nextAction:
        "RUN_PAPER_ORDER_SERVICE_TYPE_ERROR_PROBE"
    },
    null,
    2
  )
);
