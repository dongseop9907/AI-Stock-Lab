import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const TARGET_REL = "logs/alpha-v3-forward-top1-sessions.json";
const TARGET_BASENAME = path.basename(TARGET_REL);

const SESSION_MARKERS = [
  "frozen",
  "frozenContract",
  "sourceDataCutoffAtCollection",
  "qualityEvidence",
  "candidateFingerprint",
  "integrity",
  "targetSessionDate",
  "sourceTradingDate",
] as const;

function rel(file: string) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function sha256(text: string) {
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

function loadTarget() {
  const file = path.join(ROOT, TARGET_REL);

  if (!fs.existsSync(file)) {
    return null;
  }

  const text = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(text);
  const sessions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sessions)
      ? parsed.sessions
      : [];

  const row = sessions[0] ?? null;

  const signature: Record<string, boolean> = {};

  for (const marker of SESSION_MARKERS) {
    signature[marker] =
      Boolean(
        row &&
        typeof row === "object" &&
        marker in row
      );
  }

  return {
    file: TARGET_REL,
    hash: sha256(text),
    sessionCount: sessions.length,
    row: row
      ? {
          sourceTradingDate: row.sourceTradingDate ?? null,
          targetSessionDate: row.targetSessionDate ?? null,
          capturedAt: row.capturedAt ?? null,
          stockCode: row.top1?.stockCode ?? null,
          frozen: row.frozen ?? null,
          frozenContract: row.frozenContract ?? null,
          sourceDataCutoffAtCollection:
            row.sourceDataCutoffAtCollection ?? null,
          qualityEvidence:
            row.qualityEvidence ?? null,
          candidateFingerprint:
            row.candidateFingerprint ?? null,
          integrity:
            row.integrity ?? null,
        }
      : null,
    signature,
  };
}

function aliasesForTarget(text: string) {
  const aliases = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const block = lines
      .slice(i, Math.min(lines.length, i + 14))
      .join("\n");

    if (!block.includes(TARGET_BASENAME)) {
      continue;
    }

    const match =
      block.match(
        /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/,
      );

    if (match) {
      aliases.add(match[1]);
    }
  }

  return [...aliases];
}

function directWritesToAlias(
  text: string,
  aliases: string[],
) {
  const output: Array<{
    alias: string;
    api: string;
    line: number;
  }> = [];

  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const alias of aliases) {
      for (const api of [
        "writeFileSync",
        "writeFile",
        "appendFileSync",
        "appendFile",
      ]) {
        const needle1 = "fs." + api + "(";
        const needle2 = api + "(";

        if (
          (
            line.includes(needle1) ||
            line.includes(needle2)
          ) &&
          line.includes(alias)
        ) {
          output.push({
            alias,
            api,
            line: index + 1,
          });
        }
      }
    }
  }

  /*
   * Multiline call fallback.
   */
  for (const alias of aliases) {
    for (const api of [
      "writeFileSync",
      "writeFile",
      "appendFileSync",
      "appendFile",
    ]) {
      const pattern =
        new RegExp(
          "(?:fs\\.)?" +
          api +
          "\\s*\\(\\s*" +
          alias.replace(/\$/g, "\\$"),
          "g",
        );

      for (const match of text.matchAll(pattern)) {
        const before = text.slice(0, match.index ?? 0);
        const line =
          before.split(/\r?\n/).length;

        if (
          !output.some(
            row =>
              row.alias === alias &&
              row.api === api &&
              row.line === line,
          )
        ) {
          output.push({
            alias,
            api,
            line,
          });
        }
      }
    }
  }

  return output;
}

function markerProfile(text: string) {
  const profile: Record<string, boolean> = {};

  for (const marker of SESSION_MARKERS) {
    profile[marker] =
      text.includes(marker);
  }

  return profile;
}

function profileScore(
  sessionSignature: Record<string, boolean>,
  sourceProfile: Record<string, boolean>,
) {
  const positive =
    SESSION_MARKERS.filter(
      marker =>
        sessionSignature[marker] === true,
    );

  const matched =
    positive.filter(
      marker =>
        sourceProfile[marker] === true,
    );

  return {
    positiveSessionMarkers:
      positive.length,
    matchedMarkers:
      matched.length,
    matched,
    score:
      positive.length
        ? matched.length / positive.length
        : 0,
  };
}

function inspectSource(
  file: string,
  sessionSignature: Record<string, boolean>,
) {
  const text = fs.readFileSync(file, "utf8");

  if (!text.includes(TARGET_BASENAME)) {
    return null;
  }

  const aliases =
    aliasesForTarget(text);

  const directWrites =
    directWritesToAlias(
      text,
      aliases,
    );

  const profile =
    markerProfile(text);

  const score =
    profileScore(
      sessionSignature,
      profile,
    );

  const relative = rel(file);

  return {
    file: relative,
    isInstaller:
      relative.endsWith(".cjs") &&
      path.basename(relative).startsWith("install-"),
    aliases,
    directWrites,
    writesTarget:
      directWrites.length > 0,
    profile,
    profileScore: score,
    signals: {
      trueForwardCaptureV1:
        text.includes(
          "ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURE_V1",
        ),
      controlledNormal:
        text.includes(
          "CONTROLLED_NORMAL",
        ),
      qualityEvidence:
        text.includes(
          "qualityEvidence",
        ),
      sourceDataCutoffAtCollection:
        text.includes(
          "sourceDataCutoffAtCollection",
        ),
      frozenContract:
        text.includes(
          "frozenContract",
        ),
      candidateFingerprint:
        text.includes(
          "candidateFingerprint",
        ),
      integrity:
        text.includes(
          "integrity",
        ),
    },
  };
}

function main() {
  const target = loadTarget();

  if (!target) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_FORWARD_OOS_SESSION_SCHEMA_LINEAGE_TRACE_V4_NO_TARGET",
      targetFile:
        TARGET_REL,
      safety: {
        readOnly: true,
        filesWritten: 0,
      },
    }, null, 2));

    process.exitCode = 0;
    return;
  }

  const files = [
    ...walk(path.join(ROOT, "scripts")),
    ...walk(path.join(ROOT, "lib")),
    ...walk(path.join(ROOT, "app")),
  ];

  const matches =
    files
      .map(
        file =>
          inspectSource(
            file,
            target.signature,
          ),
      )
      .filter(
        (
          row,
        ): row is
          NonNullable<
            ReturnType<
              typeof inspectSource
            >
          > =>
            Boolean(row),
      );

  const runtimeDirectWriters =
    matches
      .filter(
        row =>
          row.writesTarget &&
          !row.isInstaller,
      )
      .sort(
        (a, b) =>
          b.profileScore.score -
          a.profileScore.score,
      );

  const exactLegacyShapeCandidates =
    runtimeDirectWriters.filter(
      row =>
        row.signals.frozenContract &&
        row.signals.sourceDataCutoffAtCollection &&
        row.signals.qualityEvidence,
    );

  const currentCaptureCandidates =
    runtimeDirectWriters.filter(
      row =>
        row.signals.candidateFingerprint &&
        row.signals.integrity &&
        row.signals.trueForwardCaptureV1,
    );

  const likelyLineage =
    exactLegacyShapeCandidates.length === 1
      ? exactLegacyShapeCandidates[0]
      : null;

  const sessionLooksOlderThanCurrentCapture =
    Boolean(
      target.signature.frozen &&
      target.signature.frozenContract &&
      target.signature.sourceDataCutoffAtCollection &&
      target.signature.qualityEvidence &&
      !target.signature.candidateFingerprint &&
      !target.signature.integrity,
    );

  const report = {
    status:
      "AI_STOCK_LAB_FORWARD_OOS_SESSION_SCHEMA_LINEAGE_TRACE_V4_COMPLETE",

    target,

    runtimeDirectWriters,

    lineage: {
      exactLegacyShapeCandidateCount:
        exactLegacyShapeCandidates.length,

      exactLegacyShapeCandidates:
        exactLegacyShapeCandidates.map(
          row => ({
            file: row.file,
            profileScore:
              row.profileScore,
            signals:
              row.signals,
            directWrites:
              row.directWrites,
          }),
        ),

      currentCaptureCandidateCount:
        currentCaptureCandidates.length,

      currentCaptureCandidates:
        currentCaptureCandidates.map(
          row => ({
            file: row.file,
            profileScore:
              row.profileScore,
            signals:
              row.signals,
            directWrites:
              row.directWrites,
          }),
        ),

      sessionLooksOlderThanCurrentCapture,

      likelyLineage:
        likelyLineage
          ? likelyLineage.file
          : null,
    },

    classification: {
      controlledForwardEvidence:
        false,

      legacyResearchEvidence:
        Boolean(
          likelyLineage &&
          sessionLooksOlderThanCurrentCapture,
        ),

      label:
        likelyLineage &&
        sessionLooksOlderThanCurrentCapture
          ? "LEGACY_TRUE_OOS_UNCONTROLLED"
          : "UNPROVEN_LEGACY_OR_MANUAL_SESSION",

      reason:
        likelyLineage &&
        sessionLooksOlderThanCurrentCapture
          ? "The existing session shape matches a unique legacy writer lineage and predates the current fingerprint/integrity schema, but there is no controlled-normal producer evidence."
          : "The existing row predates the current capture schema, but no unique legacy writer lineage is proven.",
    },

    recommendation: {
      preserveExistingSession:
        true,

      deleteOrRewriteExistingSession:
        false,

      controlledDashboardShouldCountIt:
        false,

      legacyResearchMayRetainIt:
        Boolean(
          likelyLineage &&
          sessionLooksOlderThanCurrentCapture,
        ),

      nextAction:
        "ADD_EXPLICIT_PROVENANCE_FILTER_AND_START_CONTROLLED_COUNT_FROM_VERIFIED_CONTROLLED_NORMAL_EVIDENCE_ONLY",
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
      "CONTROLLED_FORWARD_EVIDENCE_FILTER",
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode = 0;
}

main();
