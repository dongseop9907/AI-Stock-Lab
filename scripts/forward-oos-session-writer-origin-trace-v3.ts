import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const TARGET_REL = "logs/alpha-v3-forward-top1-sessions.json";
const TARGET_BASENAME = path.basename(TARGET_REL);
const SEARCH_ROOTS = ["scripts", "lib", "app"] as const;

type WriterKind =
  | "RUNTIME_DIRECT_WRITER"
  | "INSTALLER_GENERATED_WRITER"
  | "READ_ONLY_CONSUMER"
  | "REFERENCE_ONLY";

function rel(absolute: string) {
  return path.relative(ROOT, absolute).replaceAll("\\", "/");
}

function hash(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function walk(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "backups"].includes(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }

    if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

function lineNumberOf(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function aliasesForTarget(text: string) {
  const aliases = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const block = lines.slice(index, Math.min(lines.length, index + 12)).join("\n");

    if (!block.includes(TARGET_BASENAME)) continue;

    const match = block.match(/const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/);
    if (match) aliases.add(match[1]);
  }

  return [...aliases];
}

function hasDirectWrite(text: string, aliases: string[]) {
  const hits: Array<{ target: string; api: string; line: number; }> = [];
  const writeApis = ["writeFileSync", "writeFile", "appendFileSync", "appendFile"];

  for (const api of writeApis) {
    for (const alias of aliases) {
      const safeAlias = alias.replace(/[$]/g, "\\$");
      const pattern = new RegExp("(?:fs\\.)?" + api + "\\s*\\(\\s*" + safeAlias, "g");

      for (const match of text.matchAll(pattern)) {
        hits.push({
          target: alias,
          api,
          line: lineNumberOf(text, match.index ?? 0),
        });
      }
    }
  }

  return hits;
}

function hasRead(text: string, aliases: string[]) {
  const hits: Array<{ target: string; api: string; line: number; }> = [];
  const readApis = ["readFileSync", "readFile", "existsSync"];

  for (const api of readApis) {
    for (const alias of aliases) {
      const safeAlias = alias.replace(/[$]/g, "\\$");
      const pattern = new RegExp("(?:fs\\.)?" + api + "\\s*\\(\\s*" + safeAlias, "g");

      for (const match of text.matchAll(pattern)) {
        hits.push({
          target: alias,
          api,
          line: lineNumberOf(text, match.index ?? 0),
        });
      }
    }
  }

  return hits;
}

function inspectFile(file: string) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(TARGET_BASENAME)) return null;

  const aliases = aliasesForTarget(text);
  const writes = hasDirectWrite(text, aliases);
  const reads = hasRead(text, aliases);
  const relative = rel(file);

  const isInstaller =
    relative.toLowerCase().endsWith(".cjs") &&
    path.basename(relative).toLowerCase().startsWith("install-");

  let kind: WriterKind = "REFERENCE_ONLY";

  if (writes.length > 0 && isInstaller) {
    kind = "INSTALLER_GENERATED_WRITER";
  } else if (writes.length > 0) {
    kind = "RUNTIME_DIRECT_WRITER";
  } else if (reads.length > 0) {
    kind = "READ_ONLY_CONSUMER";
  }

  const stat = fs.statSync(file);

  return {
    file: relative,
    mtime: stat.mtime.toISOString(),
    size: stat.size,
    hash: hash(text),
    aliases,
    writes,
    reads,
    kind,
    signals: {
      containsTrueForwardVersion:
        text.includes("ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURE_V1"),
      containsStrictTrueOos:
        text.includes("STRICT_TRUE_OOS"),
      containsPendingTargetBind:
        text.includes("PENDING_TARGET_BIND"),
      containsCandidateFingerprint:
        text.includes("candidateFingerprint"),
      containsDatabaseWriteMethod:
        /\.(insert|upsert|update|delete)\s*\(/.test(text),
      containsOrderCreationTerm:
        /ordersCreated|createOrder|submitOrder/i.test(text),
    },
  };
}

function loadSession() {
  const file = path.join(ROOT, TARGET_REL);
  if (!fs.existsSync(file)) return null;

  const text = fs.readFileSync(file, "utf8");
  const stat = fs.statSync(file);

  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const sessions = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.sessions) ? parsed.sessions : []);

  const first = sessions[0] ?? null;
  const capturedAt = typeof first?.capturedAt === "string" ? first.capturedAt : null;
  const targetSessionDate = typeof first?.targetSessionDate === "string" ? first.targetSessionDate : null;
  const sourceTradingDate = typeof first?.sourceTradingDate === "string" ? first.sourceTradingDate : null;

  const targetOpenAt = targetSessionDate
    ? new Date(targetSessionDate + "T00:00:00.000Z").toISOString()
    : null;

  const capturedBeforeTargetOpen = Boolean(
    capturedAt &&
    targetOpenAt &&
    new Date(capturedAt).getTime() < new Date(targetOpenAt).getTime()
  );

  return {
    file: TARGET_REL,
    mtime: stat.mtime.toISOString(),
    hash: hash(text),
    sessionCount: sessions.length,
    firstSession: first ? {
      sourceTradingDate,
      targetSessionDate,
      capturedAt,
      targetOpenAt,
      capturedBeforeTargetOpen,
      stockCode: typeof first?.top1?.stockCode === "string" ? first.top1.stockCode : null,
      integrity: typeof first?.integrity === "string" ? first.integrity : null,
      candidateFingerprint:
        typeof first?.candidateFingerprint === "string"
          ? first.candidateFingerprint
          : null,
      frozen: first?.frozen === true,
      historicalCutoff:
        typeof first?.frozenContract?.historicalCutoff === "string"
          ? first.frozenContract.historicalCutoff
          : null,
    } : null,
  };
}

function main() {
  const inspected = SEARCH_ROOTS
    .flatMap(root => walk(path.join(ROOT, root)))
    .map(inspectFile)
    .filter((row): row is NonNullable<ReturnType<typeof inspectFile>> => Boolean(row));

  const runtimeWriters = inspected.filter(row => row.kind === "RUNTIME_DIRECT_WRITER");
  const installerGenerated = inspected.filter(row => row.kind === "INSTALLER_GENERATED_WRITER");
  const consumers = inspected.filter(row => row.kind === "READ_ONLY_CONSUMER");

  const session = loadSession();
  const canonicalRuntimeWriter = runtimeWriters.length === 1 ? runtimeWriters[0] : null;

  const writerSemanticsMatch = Boolean(
    canonicalRuntimeWriter &&
    canonicalRuntimeWriter.signals.containsTrueForwardVersion &&
    canonicalRuntimeWriter.signals.containsCandidateFingerprint
  );

  const preTargetCapture =
    session?.firstSession?.capturedBeforeTargetOpen === true;

  const legacyTrueOosUncontrolled = Boolean(
    canonicalRuntimeWriter &&
    writerSemanticsMatch &&
    preTargetCapture
  );

  const report = {
    status: "AI_STOCK_LAB_FORWARD_OOS_SESSION_WRITER_ORIGIN_TRACE_V3_COMPLETE",
    target: session,
    writerResolution: {
      runtimeWriterCount: runtimeWriters.length,
      canonicalRuntimeWriter: canonicalRuntimeWriter ? {
        file: canonicalRuntimeWriter.file,
        mtime: canonicalRuntimeWriter.mtime,
        aliases: canonicalRuntimeWriter.aliases,
        writes: canonicalRuntimeWriter.writes,
        signals: canonicalRuntimeWriter.signals,
      } : null,
      installerGeneratedWriterCount: installerGenerated.length,
      readOnlyConsumerCount: consumers.length,
      runtimeWriters,
      installerGeneratedWriters: installerGenerated.map(row => ({
        file: row.file,
        aliases: row.aliases,
        writeCount: row.writes.length,
      })),
    },
    provenanceAssessment: {
      uniqueRuntimeWriter: runtimeWriters.length === 1,
      writerSemanticsMatchTrueForwardCapture: writerSemanticsMatch,
      capturedBeforeTargetOpen: preTargetCapture,
      legacyTrueOosUncontrolled,
      classification:
        legacyTrueOosUncontrolled
          ? "LEGACY_TRUE_OOS_UNCONTROLLED"
          : (runtimeWriters.length === 1
              ? "WRITER_IDENTIFIED_PROVENANCE_INCOMPLETE"
              : "INCONCLUSIVE"),
      countTowardControlledForwardEvidence: false,
      countTowardLegacyResearchEvidence: legacyTrueOosUncontrolled,
      reason:
        legacyTrueOosUncontrolled
          ? "A unique runtime writer using the true-forward capture contract wrote the target file before the target session opened, but no controlled-normal producer evidence proves this session belongs to the current controlled evidence stream."
          : "Runtime writer or execution provenance is insufficient for controlled evidence.",
    },
    recommendation: {
      preserveExistingSession: true,
      deleteOrRewriteExistingSession: false,
      controlledForwardDashboardShouldCountIt: false,
      legacyResearchMayRetainIt: legacyTrueOosUncontrolled,
      nextAction:
        legacyTrueOosUncontrolled
          ? "ADD_PROVENANCE_FILTER_SO_CONTROLLED_DASHBOARD_EXCLUDES_LEGACY_UNCONTROLLED_SESSION"
          : "KEEP_SESSION_EXCLUDED_AND_REVIEW_RUNTIME_WRITER",
    },
    safety: {
      readOnly: true,
      filesWritten: 0,
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      promotionExecuted: false,
      realTradingEnabled: false,
    },
    nextGate:
      "PROTECT_CONTROLLED_FORWARD_EVIDENCE_FROM_LEGACY_OR_UNPROVEN_SESSIONS",
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 0;
}

main();
