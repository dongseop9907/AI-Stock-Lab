const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "tsconfig.risk-v3.json"
);

const config = {
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": [
    "lib/trading/policy.ts",
    "lib/trading/types.ts",
    "lib/trading/risk-manager.ts",
    "lib/trading/paper-order-service.ts",
    "lib/trading/read-only-buy-risk-preflight.ts",
    "scripts/alpha-v3-aggregate-open-risk-verify.ts",
    "scripts/alpha-v3-aggregate-open-risk-integration-test.ts",
    "scripts/alpha-v3-risk-v3-post-implementation-stress-test.ts"
  ],
  "exclude": [
    "node_modules",
    ".next"
  ]
};

fs.writeFileSync(
  target,
  JSON.stringify(config, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_RISK_V3_TARGETED_TYPECHECK_INSTALLED",

      generatedFile:
        "tsconfig.risk-v3.json",

      includedFiles:
        config.include,

      excluded:
        config.exclude,

      nextAction:
        "RUN_TARGETED_TYPESCRIPT_CHECK_THEN_STRESS_TEST"
    },
    null,
    2
  )
);
