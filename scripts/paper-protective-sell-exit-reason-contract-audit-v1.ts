import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const ROOTS = [
  "app",
  "lib",
  "src",
  "supabase/migrations",
].map(p => path.join(ROOT, p));

const ALLOWED = [
  "STOP_LOSS",
  "TRAILING_STOP",
  "MODEL_EXIT",
  "MANUAL",
];

const RPCS = [
  "execute_paper_protective_sell_v2",
  "execute_paper_protective_sell_v3",
  "execute_paper_protective_sell_v4",
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const out: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git"
    ) {
      continue;
    }

    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(abs));
      continue;
    }

    if (
      entry.isFile() &&
      /\.(ts|tsx|js|cjs|mjs|sql)$/i.test(entry.name)
    ) {
      out.push(abs);
    }
  }

  return out;
}

function rel(file: string) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function lineNumber(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function context(text: string, index: number, radius = 500) {
  return text
    .slice(
      Math.max(0, index - radius),
      Math.min(text.length, index + radius),
    )
    .replace(/\r/g, "");
}

const files =
  ROOTS.flatMap(walk);

const definitions: any[] = [];
const callers: any[] = [];

for (const file of files) {
  const text =
    fs.readFileSync(file, "utf8");

  for (const rpc of RPCS) {
    let cursor = 0;

    while (true) {
      const index =
        text.indexOf(rpc, cursor);

      if (index < 0) break;

      const ctx =
        context(text, index, 900);

      const before =
        text.slice(
          Math.max(0, index - 140),
          index
        );

      const isDefinition =
        /create\s+or\s+replace\s+function\s+public\.\s*$/i.test(before) ||
        /create\s+function\s+public\.\s*$/i.test(before);

      if (isDefinition) {
        const defaultMatch =
          ctx.match(
            /p_exit_reason\s+text\s+default\s+'([^']+)'/i
          );

        definitions.push({
          file: rel(file),
          line: lineNumber(text, index),
          rpc,
          defaultExitReason:
            defaultMatch?.[1] ?? null,
          defaultAllowed:
            defaultMatch
              ? ALLOWED.includes(defaultMatch[1])
              : null,
        });
      } else {
        const looksLikeInvocation =
          ctx.includes(".rpc(") ||
          ctx.includes("select public.") ||
          ctx.includes("perform public.") ||
          ctx.includes(`${rpc}(`);

        if (looksLikeInvocation) {
          const explicitReasonMatches =
            [...ctx.matchAll(
              /(?:p_exit_reason|exitReason|exit_reason)\s*[:=,)]?\s*['"]([A-Z_]+)['"]/g
            )]
            .map(m => m[1]);

          const explicitReasons =
            [...new Set(explicitReasonMatches)];

          const hasStopLoss =
            ctx.includes("STOP_LOSS");

          const hasTrailingStop =
            ctx.includes("TRAILING_STOP");

          const hasModelExit =
            ctx.includes("MODEL_EXIT");

          const hasManual =
            ctx.includes("MANUAL");

          const inferredReasons =
            [
              hasStopLoss ? "STOP_LOSS" : null,
              hasTrailingStop ? "TRAILING_STOP" : null,
              hasModelExit ? "MODEL_EXIT" : null,
              hasManual ? "MANUAL" : null,
            ].filter(Boolean);

          const reasons =
            [...new Set([
              ...explicitReasons,
              ...inferredReasons,
            ])];

          callers.push({
            file: rel(file),
            line: lineNumber(text, index),
            rpc,
            reasons,
            hasExplicitAllowedReason:
              reasons.some(r => ALLOWED.includes(String(r))),
            hasInvalidProtectiveStop:
              ctx.includes("PROTECTIVE_STOP"),
            context:
              ctx.slice(0, 1800),
          });
        }
      }

      cursor =
        index + rpc.length;
    }
  }
}

const productionCallers =
  callers.filter(c =>
    !c.file.startsWith("supabase/migrations/")
  );

const migrationDelegations =
  callers.filter(c =>
    c.file.startsWith("supabase/migrations/")
  );

const invalidDefaults =
  definitions.filter(d =>
    d.defaultExitReason &&
    !d.defaultAllowed
  );

const productionCallersWithoutAllowedReason =
  productionCallers.filter(c =>
    !c.hasExplicitAllowedReason
  );

const productionCallersWithInvalidProtectiveStop =
  productionCallers.filter(c =>
    c.hasInvalidProtectiveStop
  );

const activeV4ProductionCallers =
  productionCallers.filter(c =>
    c.rpc === "execute_paper_protective_sell_v4"
  );

const activeV4CallersWithoutAllowedReason =
  activeV4ProductionCallers.filter(c =>
    !c.hasExplicitAllowedReason
  );

let classification = "";
let status = "";

if (activeV4CallersWithoutAllowedReason.length > 0) {
  status =
    "AI_STOCK_LAB_PROTECTIVE_SELL_EXIT_REASON_CONTRACT_AUDIT_V1_FAIL";

  classification =
    "ACTIVE_V4_PRODUCTION_CALLER_CAN_REACH_INVALID_EXIT_REASON_DEFAULT";
} else if (invalidDefaults.length > 0) {
  status =
    "AI_STOCK_LAB_PROTECTIVE_SELL_EXIT_REASON_CONTRACT_AUDIT_V1_REVIEW";

  classification =
    "INVALID_PROTECTIVE_SELL_DEFAULT_EXISTS_BUT_ACTIVE_CALLERS_APPEAR_EXPLICITLY_GUARDED";
} else {
  status =
    "AI_STOCK_LAB_PROTECTIVE_SELL_EXIT_REASON_CONTRACT_AUDIT_V1_PASS";

  classification =
    "PROTECTIVE_SELL_EXIT_REASON_CONTRACT_ALIGNED";
}

console.log(JSON.stringify({
  status,
  classification,

  deployedConstraintFromLatestRuntimeEvidence: {
    allowedExitReasons: ALLOWED,
    rejectedObservedValue: "PROTECTIVE_STOP",
  },

  definitions,

  productionCallers: productionCallers.map(c => ({
    file: c.file,
    line: c.line,
    rpc: c.rpc,
    reasons: c.reasons,
    hasExplicitAllowedReason:
      c.hasExplicitAllowedReason,
    hasInvalidProtectiveStop:
      c.hasInvalidProtectiveStop,
  })),

  migrationDelegations: migrationDelegations.map(c => ({
    file: c.file,
    line: c.line,
    rpc: c.rpc,
    reasons: c.reasons,
    hasExplicitAllowedReason:
      c.hasExplicitAllowedReason,
    hasInvalidProtectiveStop:
      c.hasInvalidProtectiveStop,
  })),

  summary: {
    rpcDefinitions:
      definitions.length,

    invalidDefaultDefinitions:
      invalidDefaults.length,

    productionCallerOccurrences:
      productionCallers.length,

    activeV4ProductionCallerOccurrences:
      activeV4ProductionCallers.length,

    productionCallersWithoutAllowedReason:
      productionCallersWithoutAllowedReason.length,

    activeV4CallersWithoutAllowedReason:
      activeV4CallersWithoutAllowedReason.length,

    productionCallersUsingProtectiveStop:
      productionCallersWithInvalidProtectiveStop.length,
  },

  risk: {
    latentDefaultContractMismatch:
      invalidDefaults.length > 0,

    activeProductionFailurePathFound:
      activeV4CallersWithoutAllowedReason.length > 0,

    explanation:
      activeV4CallersWithoutAllowedReason.length > 0
        ? "At least one active V4 production caller does not appear to pass an allowed exit_reason. A SELL can fail at paper_trade_history_exit_reason_check."
        : invalidDefaults.length > 0
          ? "The RPC default is incompatible with the deployed DB CHECK, but active V4 production callers appear to pass allowed reasons explicitly. The default remains a latent defect."
          : "No exit_reason contract mismatch found.",
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    productionModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    activeV4CallersWithoutAllowedReason.length > 0
      ? "REPAIR_ACTIVE_PROTECTIVE_SELL_EXIT_REASON_CONTRACT_BEFORE_RUNTIME_REPLAY_TEST"
      : invalidDefaults.length > 0
        ? "REPAIR_LATENT_PROTECTIVE_SELL_DEFAULT_THEN_RUN_V4_RUNTIME_REPLAY_REGRESSION"
        : "RUN_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION",
}, null, 2));

process.exitCode =
  activeV4CallersWithoutAllowedReason.length > 0
    ? 1
    : 0;
