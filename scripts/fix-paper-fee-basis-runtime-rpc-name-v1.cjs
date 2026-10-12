const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "scripts",
  "paper-partial-exit-multi-buy-fee-basis-runtime-regression-v1.ts"
);

if (!fs.existsSync(target)) {
  throw new Error(`RUNNER_NOT_FOUND:${target}`);
}

const before =
  fs.readFileSync(target, "utf8");

const oldPath =
  "/rpc/run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1";

const newPath =
  "/rpc/run_paper_fee_basis_rt_v1";

const oldCount =
  before.split(oldPath).length - 1;

const newCount =
  before.split(newPath).length - 1;

if (newCount > 0 && oldCount === 0) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_RUNNER_ALREADY_PATCHED",
    target:
      "scripts/paper-partial-exit-multi-buy-fee-basis-runtime-regression-v1.ts",
    productionModified:
      false
  }, null, 2));

  process.exitCode = 0;
}
else {
  if (oldCount !== 1) {
    throw new Error(
      `EXPECTED_EXACTLY_ONE_OLD_RPC_PATH count=${oldCount}`
    );
  }

  const after =
    before.replace(oldPath, newPath);

  fs.writeFileSync(
    target,
    after,
    "utf8"
  );

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_RPC_RUNNER_PATCHED",
    target:
      "scripts/paper-partial-exit-multi-buy-fee-basis-runtime-regression-v1.ts",
    change:
      `${oldPath} -> ${newPath}`,
    productionModified:
      false
  }, null, 2));

  process.exitCode = 0;
}
