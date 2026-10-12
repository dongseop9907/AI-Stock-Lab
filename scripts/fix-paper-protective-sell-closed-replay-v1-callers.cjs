const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const targets = [
  path.join(
    ROOT,
    "lib",
    "trading",
    "check-stop-losses.ts"
  ),
  path.join(
    ROOT,
    "lib",
    "trading",
    "update-trailing-stops.ts"
  )
];

const results = [];

for (const file of targets) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `TARGET_NOT_FOUND: ${file}`
    );
  }

  const before =
    fs.readFileSync(
      file,
      "utf8"
    );

  const v3Count =
    (
      before.match(
        /execute_paper_protective_sell_v3/g
      ) || []
    ).length;

  const v4Count =
    (
      before.match(
        /execute_paper_protective_sell_v4/g
      ) || []
    ).length;

  if (v4Count > 0 && v3Count === 0) {
    results.push({
      file:
        path.relative(ROOT, file)
          .replaceAll("\\", "/"),
      status:
        "ALREADY_V4"
    });

    continue;
  }

  if (v3Count !== 1) {
    throw new Error(
      `EXPECTED_EXACTLY_ONE_V3_REFERENCE: ${file} count=${v3Count}`
    );
  }

  const after =
    before.replace(
      /execute_paper_protective_sell_v3/g,
      "execute_paper_protective_sell_v4"
    );

  fs.writeFileSync(
    file,
    after,
    "utf8"
  );

  results.push({
    file:
      path.relative(ROOT, file)
        .replaceAll("\\", "/"),
    status:
      "UPDATED_V3_TO_V4"
  });
}

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1_CALLERS_UPDATED",
  results,
  realTradingEnabled:
    false
}, null, 2));

process.exitCode = 0;
