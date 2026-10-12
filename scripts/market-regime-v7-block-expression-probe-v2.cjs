const fs = require("fs");
const path = require("path");

const root = process.cwd();
const rel = "lib/market/market-regime-v7-policy.ts";
const abs = path.resolve(root, rel);

if (!fs.existsSync(abs)) {
  throw new Error("POLICY_FILE_NOT_FOUND");
}

const source = fs.readFileSync(abs, "utf8");
const lines = source.split(/\r?\n/);

function statementContaining(startNeedle) {
  const start = lines.findIndex((line) =>
    line.includes(startNeedle)
  );

  if (start < 0) {
    return null;
  }

  const picked = [];
  for (let i = start; i < lines.length; i += 1) {
    picked.push(lines[i].trim());

    if (lines[i].includes(";")) {
      break;
    }

    if (picked.length >= 12) {
      break;
    }
  }

  return {
    startLine: start + 1,
    text: picked.join(" ").replace(/\s+/g, " ").trim(),
  };
}

function caseBlock(caseNeedle) {
  const start = lines.findIndex((line) =>
    line.includes(caseNeedle)
  );

  if (start < 0) {
    return null;
  }

  const picked = [];

  for (let i = start; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();

    if (
      i > start &&
      (
        trimmed.startsWith("case ") ||
        trimmed.startsWith("default:")
      )
    ) {
      break;
    }

    picked.push(trimmed);

    if (picked.length >= 16) {
      break;
    }
  }

  return {
    startLine: start + 1,
    text: picked.join(" ").replace(/\s+/g, " ").trim(),
  };
}

const blockedInit =
  statementContaining("let blocked =");

const targetCase =
  caseBlock('case "BLOCK_BREADTH_OR_HIGH_VOL":');

const nearbyInputs =
  lines
    .map((text, index) => ({
      line: index + 1,
      text: text.trim(),
    }))
    .filter((row) =>
      row.line >= 90 &&
      row.line <= 145 &&
      (
        /breadth/i.test(row.text) ||
        /vol/i.test(row.text) ||
        /regime/i.test(row.text)
      )
    )
    .slice(0, 12);

const output = {
  status:
    "MARKET_REGIME_V7_BLOCK_EXPRESSION_PROBE_V2_COMPLETE",
  policyFile: rel,
  blockedInit,
  targetCase,
  nearbyInputs,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
  },
  nextGate:
    "CONFIRM_EXACT_BOOLEAN_INVERSION_THEN_PATCH",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(
    root,
    "logs/market-regime-v7-block-expression-probe-v2.json"
  ),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: output.status,
      blockedInit: output.blockedInit,
      targetCase: output.targetCase,
      nearbyInputs: output.nearbyInputs,
      nextGate: output.nextGate,
    },
    null,
    2
  )
);
