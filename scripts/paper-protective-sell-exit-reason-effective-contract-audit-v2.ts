import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const MIG_DIR = path.join(
  ROOT,
  "supabase",
  "migrations",
);

const RPCS = [
  "execute_paper_protective_sell_v2",
  "execute_paper_protective_sell_v3",
  "execute_paper_protective_sell_v4",
];

const ALLOWED = [
  "STOP_LOSS",
  "TRAILING_STOP",
  "MODEL_EXIT",
  "MANUAL",
];

function filesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(name => name.endsWith(".sql"))
    .sort()
    .map(name => path.join(dir, name));
}

function extractDefinitions(
  text: string,
  rpc: string,
) {
  const out: string[] = [];
  const marker =
    `create or replace function public.${rpc}(`;

  let cursor = 0;

  while (true) {
    const start =
      text.toLowerCase().indexOf(
        marker.toLowerCase(),
        cursor,
      );

    if (start < 0) break;

    const end =
      text.indexOf("$$;", start);

    if (end < 0) break;

    out.push(
      text.slice(start, end + 3)
    );

    cursor =
      end + 3;
  }

  return out;
}

const latest: Record<string, any> = {};

for (const file of filesIn(MIG_DIR)) {
  const text =
    fs.readFileSync(file, "utf8");

  for (const rpc of RPCS) {
    const defs =
      extractDefinitions(text, rpc);

    for (const definition of defs) {
      const defaultMatch =
        definition.match(
          /p_exit_reason\s+text\s+default\s+'([^']+)'/i
        );

      latest[rpc] = {
        file:
          path.relative(ROOT, file)
            .replaceAll("\\", "/"),

        defaultExitReason:
          defaultMatch?.[1] ?? null,

        defaultAllowed:
          defaultMatch
            ? ALLOWED.includes(defaultMatch[1])
            : false,

        bodyStillDelegatesCorrectly:
          rpc === "execute_paper_protective_sell_v2"
            ? definition.includes(
                "paper_trade_history"
              )
            : rpc === "execute_paper_protective_sell_v3"
              ? definition.includes(
                  "execute_paper_protective_sell_v2("
                )
              : definition.includes(
                  "execute_paper_protective_sell_v3("
                ),
      };
    }
  }
}

const callerFiles = [
  path.join(
    ROOT,
    "lib",
    "trading",
    "check-stop-losses.ts",
  ),
  path.join(
    ROOT,
    "lib",
    "trading",
    "update-trailing-stops.ts",
  ),
];

const callers = callerFiles.map(file => {
  const exists =
    fs.existsSync(file);

  const text =
    exists
      ? fs.readFileSync(file, "utf8")
      : "";

  return {
    file:
      path.relative(ROOT, file)
        .replaceAll("\\", "/"),

    exists,

    callsV4:
      text.includes(
        "execute_paper_protective_sell_v4"
      ),

    hasStopLoss:
      text.includes("STOP_LOSS"),

    hasTrailingStop:
      text.includes("TRAILING_STOP"),
  };
});

const checks = {
  allEffectiveDefinitionsFound:
    RPCS.every(rpc => Boolean(latest[rpc])),

  allEffectiveDefaultsAllowed:
    RPCS.every(
      rpc =>
        latest[rpc]?.defaultAllowed === true
    ),

  allEffectiveDefaultsStopLoss:
    RPCS.every(
      rpc =>
        latest[rpc]?.defaultExitReason ===
        "STOP_LOSS"
    ),

  v2BodyRetained:
    latest.execute_paper_protective_sell_v2
      ?.bodyStillDelegatesCorrectly === true,

  v3DelegationRetained:
    latest.execute_paper_protective_sell_v3
      ?.bodyStillDelegatesCorrectly === true,

  v4DelegationRetained:
    latest.execute_paper_protective_sell_v4
      ?.bodyStillDelegatesCorrectly === true,

  stopLossCallerExplicit:
    callers.some(
      c =>
        c.file.endsWith(
          "lib/trading/check-stop-losses.ts"
        ) &&
        c.callsV4 &&
        c.hasStopLoss
    ),

  trailingStopCallerExplicit:
    callers.some(
      c =>
        c.file.endsWith(
          "lib/trading/update-trailing-stops.ts"
        ) &&
        c.callsV4 &&
        c.hasTrailingStop
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PROTECTIVE_SELL_EXIT_REASON_EFFECTIVE_CONTRACT_AUDIT_V2_PASS"
      : "AI_STOCK_LAB_PROTECTIVE_SELL_EXIT_REASON_EFFECTIVE_CONTRACT_AUDIT_V2_FAIL",

  classification:
    failed.length === 0
      ? "PROTECTIVE_SELL_EFFECTIVE_DEFAULT_CONTRACT_ALIGNED_AND_CALLERS_EXPLICIT"
      : "PROTECTIVE_SELL_EFFECTIVE_CONTRACT_REVIEW_REQUIRED",

  latestDefinitions:
    latest,

  callers,

  checks,
  failed,

  deployedConstraintEvidence: {
    allowedExitReasons:
      ALLOWED,

    previouslyRejectedDefault:
      "PROTECTIVE_STOP",

    repairedDefault:
      "STOP_LOSS",
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "RUN_PROTECTIVE_SELL_V4_CONTROLLED_RUNTIME_REPLAY_REGRESSION"
      : "STOP_AND_REVIEW",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
