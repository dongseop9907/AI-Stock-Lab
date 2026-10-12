import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_V1 =
  "logs/true-forward-oos-controlled-producer-evidence-ledger-v1.jsonl";

export const VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_SCHEMA_V1 =
  "FORWARD_OOS_VERIFIED_PROVENANCE_LEDGER_V1" as const;

type JsonRecord = Record<string, unknown>;

export interface VerifiedForwardOosProvenanceLedgerEntryV1 {
  schemaVersion:
    typeof VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_SCHEMA_V1;
  verifiedAt: string;
  runId: string;
  mode: "CONTROLLED_NORMAL";
  evidenceStatus: string;
  evidenceFile: string;
  sessionFile: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  sessionDelta: number;
  sessions: Array<{
    sessionKey: string;
    sourceTradingDate: string | null;
    targetSessionDate: string | null;
    stockCode: string | null;
    candidateFingerprint: string;
    integrityPayloadHash: string;
  }>;
  previousEntryHash: string | null;
  entryHash: string;
}

export interface VerifiedForwardOosProvenanceLedgerSnapshotV1 {
  exists: boolean;
  file: string;
  entries: VerifiedForwardOosProvenanceLedgerEntryV1[];
  invalidLineCount: number;
  chainValid: boolean;
  duplicateRunIds: string[];
  valid: boolean;
}

function asRecord(value: unknown): JsonRecord | null {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as JsonRecord
    : null;
}

function text(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0
  )
    ? value
    : null;
}

function isSha256(value: unknown) {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/i.test(value)
  );
}

function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return (
      "[" +
      value.map(canonical).join(",") +
      "]"
    );
  }

  const row = asRecord(value);

  if (!row) {
    return JSON.stringify(String(value));
  }

  return (
    "{" +
    Object.keys(row)
      .sort()
      .map(
        key =>
          JSON.stringify(key) +
          ":" +
          canonical(row[key]),
      )
      .join(",") +
    "}"
  );
}

function sha256(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(canonical(value))
    .digest("hex");
}

function stockCodeOf(row: JsonRecord) {
  const top1 = asRecord(row.top1);

  return (
    text(row.stockCode) ??
    text(row.stock_code) ??
    text(top1?.stockCode) ??
    text(top1?.stock_code)
  );
}

export function forwardOosSessionProvenanceKeyV1(
  session: unknown,
) {
  const row = asRecord(session);

  if (!row) {
    return "||";
  }

  return [
    text(row.sourceTradingDate) ?? "",
    text(row.targetSessionDate) ?? "",
    stockCodeOf(row) ?? "",
  ].join("|");
}

function sessionAttestation(session: unknown) {
  const row = asRecord(session);
  const integrity =
    asRecord(row?.integrity);

  return {
    sessionKey:
      forwardOosSessionProvenanceKeyV1(
        session,
      ),
    sourceTradingDate:
      text(row?.sourceTradingDate),
    targetSessionDate:
      text(row?.targetSessionDate),
    stockCode:
      row
        ? stockCodeOf(row)
        : null,
    candidateFingerprint:
      text(row?.candidateFingerprint) ?? "",
    integrityPayloadHash:
      text(integrity?.payloadHash) ?? "",
  };
}

function entryHashInput(
  entry: Omit<
    VerifiedForwardOosProvenanceLedgerEntryV1,
    "entryHash"
  >,
) {
  return {
    schemaVersion: entry.schemaVersion,
    verifiedAt: entry.verifiedAt,
    runId: entry.runId,
    mode: entry.mode,
    evidenceStatus: entry.evidenceStatus,
    evidenceFile: entry.evidenceFile,
    sessionFile: entry.sessionFile,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    sessionDelta: entry.sessionDelta,
    sessions: entry.sessions,
    previousEntryHash:
      entry.previousEntryHash,
  };
}

function parseEntry(
  value: unknown,
): VerifiedForwardOosProvenanceLedgerEntryV1 | null {
  const row = asRecord(value);

  if (
    !row ||
    row.schemaVersion !==
      VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_SCHEMA_V1 ||
    row.mode !== "CONTROLLED_NORMAL" ||
    !text(row.verifiedAt) ||
    !text(row.runId) ||
    !text(row.evidenceStatus) ||
    !text(row.evidenceFile) ||
    typeof row.sessionDelta !== "number" ||
    !Number.isFinite(row.sessionDelta) ||
    !Array.isArray(row.sessions) ||
    !isSha256(row.entryHash)
  ) {
    return null;
  }

  const sessions =
    row.sessions.map(
      raw => {
        const item = asRecord(raw);

        if (!item) {
          return null;
        }

        const sessionKey =
          text(item.sessionKey);
        const candidateFingerprint =
          text(item.candidateFingerprint);
        const integrityPayloadHash =
          text(item.integrityPayloadHash);

        if (
          !sessionKey ||
          !isSha256(candidateFingerprint) ||
          !isSha256(integrityPayloadHash)
        ) {
          return null;
        }

        return {
          sessionKey,
          sourceTradingDate:
            text(item.sourceTradingDate),
          targetSessionDate:
            text(item.targetSessionDate),
          stockCode:
            text(item.stockCode),
          candidateFingerprint:
            candidateFingerprint as string,
          integrityPayloadHash:
            integrityPayloadHash as string,
        };
      },
    );

  if (
    sessions.some(
      item => item === null,
    )
  ) {
    return null;
  }

  const previousEntryHash =
    row.previousEntryHash === null
      ? null
      : text(row.previousEntryHash);

  if (
    row.previousEntryHash !== null &&
    !isSha256(previousEntryHash)
  ) {
    return null;
  }

  return {
    schemaVersion:
      VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_SCHEMA_V1,
    verifiedAt:
      String(row.verifiedAt),
    runId:
      String(row.runId),
    mode:
      "CONTROLLED_NORMAL",
    evidenceStatus:
      String(row.evidenceStatus),
    evidenceFile:
      String(row.evidenceFile),
    sessionFile:
      row.sessionFile === null
        ? null
        : text(row.sessionFile),
    beforeHash:
      row.beforeHash === null
        ? null
        : text(row.beforeHash),
    afterHash:
      row.afterHash === null
        ? null
        : text(row.afterHash),
    sessionDelta:
      Number(row.sessionDelta),
    sessions:
      sessions as VerifiedForwardOosProvenanceLedgerEntryV1["sessions"],
    previousEntryHash,
    entryHash:
      String(row.entryHash),
  };
}

export function readVerifiedForwardOosProvenanceLedgerV1(
  root = process.cwd(),
): VerifiedForwardOosProvenanceLedgerSnapshotV1 {
  const absolute =
    path.join(
      root,
      VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_V1,
    );

  if (!fs.existsSync(absolute)) {
    return {
      exists: false,
      file:
        VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_V1,
      entries: [],
      invalidLineCount: 0,
      chainValid: true,
      duplicateRunIds: [],
      valid: true,
    };
  }

  const lines =
    fs.readFileSync(
      absolute,
      "utf8",
    )
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim().length > 0,
      );

  const entries:
    VerifiedForwardOosProvenanceLedgerEntryV1[] =
      [];

  let invalidLineCount = 0;
  let chainValid = true;
  let previousHash:
    string | null = null;

  for (const line of lines) {
    let parsed: unknown = null;

    try {
      parsed = JSON.parse(line);
    }
    catch {
      invalidLineCount += 1;
      chainValid = false;
      continue;
    }

    const entry = parseEntry(parsed);

    if (!entry) {
      invalidLineCount += 1;
      chainValid = false;
      continue;
    }

    if (
      entry.previousEntryHash !==
      previousHash
    ) {
      chainValid = false;
    }

    const core = {
      schemaVersion:
        entry.schemaVersion,
      verifiedAt:
        entry.verifiedAt,
      runId:
        entry.runId,
      mode:
        entry.mode,
      evidenceStatus:
        entry.evidenceStatus,
      evidenceFile:
        entry.evidenceFile,
      sessionFile:
        entry.sessionFile,
      beforeHash:
        entry.beforeHash,
      afterHash:
        entry.afterHash,
      sessionDelta:
        entry.sessionDelta,
      sessions:
        entry.sessions,
      previousEntryHash:
        entry.previousEntryHash,
    };

    if (
      sha256(core) !==
      entry.entryHash
    ) {
      chainValid = false;
    }

    entries.push(entry);
    previousHash =
      entry.entryHash;
  }

  const seen =
    new Set<string>();
  const duplicateRunIds:
    string[] = [];

  for (const entry of entries) {
    if (seen.has(entry.runId)) {
      duplicateRunIds.push(
        entry.runId,
      );
    }

    seen.add(entry.runId);
  }

  const uniqueDuplicates =
    [...new Set(duplicateRunIds)];

  return {
    exists: true,
    file:
      VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_V1,
    entries,
    invalidLineCount,
    chainValid,
    duplicateRunIds:
      uniqueDuplicates,
    valid:
      invalidLineCount === 0 &&
      chainValid &&
      uniqueDuplicates.length === 0,
  };
}

export function verifyForwardOosSessionAgainstLedgerV1(
  session: unknown,
  ledger =
    readVerifiedForwardOosProvenanceLedgerV1(),
) {
  const row = asRecord(session);
  const sessionKey =
    forwardOosSessionProvenanceKeyV1(
      session,
    );

  if (!row) {
    return {
      valid: false,
      reason:
        "SESSION_NOT_OBJECT",
      runId: null as string | null,
      sessionKey,
    };
  }

  if (!ledger.valid) {
    return {
      valid: false,
      reason:
        "LEDGER_INTEGRITY_INVALID",
      runId: null as string | null,
      sessionKey,
    };
  }

  const provenance =
    asRecord(row.provenance);
  const integrity =
    asRecord(row.integrity);

  const mode =
    text(provenance?.mode);
  const runId =
    text(provenance?.runId);
  const candidateFingerprint =
    text(row.candidateFingerprint);
  const integrityAlgorithm =
    text(integrity?.algorithm);
  const integrityPayloadHash =
    text(integrity?.payloadHash);

  if (mode !== "CONTROLLED_NORMAL") {
    return {
      valid: false,
      reason:
        "SESSION_MODE_NOT_CONTROLLED_NORMAL",
      runId,
      sessionKey,
    };
  }

  if (!runId) {
    return {
      valid: false,
      reason:
        "SESSION_RUN_ID_MISSING",
      runId,
      sessionKey,
    };
  }

  if (!isSha256(candidateFingerprint)) {
    return {
      valid: false,
      reason:
        "SESSION_CANDIDATE_FINGERPRINT_INVALID",
      runId,
      sessionKey,
    };
  }

  if (
    integrityAlgorithm !== "sha256" ||
    !isSha256(integrityPayloadHash)
  ) {
    return {
      valid: false,
      reason:
        "SESSION_INTEGRITY_INVALID",
      runId,
      sessionKey,
    };
  }

  const ledgerEntry =
    ledger.entries.find(
      entry =>
        entry.runId === runId,
    );

  if (!ledgerEntry) {
    return {
      valid: false,
      reason:
        "RUN_ID_NOT_VERIFIED_IN_LEDGER",
      runId,
      sessionKey,
    };
  }

  const attestation =
    ledgerEntry.sessions.find(
      item =>
        item.sessionKey ===
        sessionKey,
    );

  if (!attestation) {
    return {
      valid: false,
      reason:
        "SESSION_KEY_NOT_ATTESTED_IN_LEDGER",
      runId,
      sessionKey,
    };
  }

  if (
    attestation.candidateFingerprint !==
      candidateFingerprint ||
    attestation.integrityPayloadHash !==
      integrityPayloadHash
  ) {
    return {
      valid: false,
      reason:
        "SESSION_ATTESTATION_MISMATCH",
      runId,
      sessionKey,
    };
  }

  return {
    valid: true,
    reason:
      "VERIFIED_CONTROLLED_FORWARD_SESSION",
    runId,
    sessionKey,
  };
}

export function appendVerifiedForwardOosProvenanceLedgerV1(
  input: {
    verifiedAt: string;
    runId: string;
    evidenceStatus: string;
    evidenceFile: string;
    sessionFile: string | null;
    beforeHash: string | null;
    afterHash: string | null;
    sessionDelta: number;
    sessions: unknown[];
  },
  root = process.cwd(),
) {
  const ledger =
    readVerifiedForwardOosProvenanceLedgerV1(
      root,
    );

  if (!ledger.valid) {
    throw new Error(
      "VERIFIED_PROVENANCE_LEDGER_INTEGRITY_INVALID",
    );
  }

  const existing =
    ledger.entries.find(
      entry =>
        entry.runId === input.runId,
    );

  if (existing) {
    return {
      appended: false,
      duplicateSuppressed: true,
      entry: existing,
    };
  }

  if (
    !input.runId ||
    input.sessions.length !== 1
  ) {
    throw new Error(
      "VERIFIED_PROVENANCE_LEDGER_REQUIRES_ONE_SESSION_AND_RUN_ID",
    );
  }

  const sessions =
    input.sessions.map(
      sessionAttestation,
    );

  if (
    sessions.some(
      item =>
        !item.sessionKey ||
        !isSha256(
          item.candidateFingerprint,
        ) ||
        !isSha256(
          item.integrityPayloadHash,
        ),
    )
  ) {
    throw new Error(
      "VERIFIED_PROVENANCE_LEDGER_SESSION_ATTESTATION_INVALID",
    );
  }

  const previousEntryHash =
    ledger.entries.length > 0
      ? ledger.entries[
          ledger.entries.length - 1
        ]?.entryHash ?? null
      : null;

  const core = {
    schemaVersion:
      VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_SCHEMA_V1,
    verifiedAt:
      input.verifiedAt,
    runId:
      input.runId,
    mode:
      "CONTROLLED_NORMAL" as const,
    evidenceStatus:
      input.evidenceStatus,
    evidenceFile:
      input.evidenceFile,
    sessionFile:
      input.sessionFile,
    beforeHash:
      input.beforeHash,
    afterHash:
      input.afterHash,
    sessionDelta:
      input.sessionDelta,
    sessions,
    previousEntryHash,
  };

  const entry:
    VerifiedForwardOosProvenanceLedgerEntryV1 =
      {
        ...core,
        entryHash:
          sha256(core),
      };

  const absolute =
    path.join(
      root,
      VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_V1,
    );

  fs.mkdirSync(
    path.dirname(absolute),
    {
      recursive: true,
    },
  );

  fs.appendFileSync(
    absolute,
    JSON.stringify(entry) + "\n",
    "utf8",
  );

  return {
    appended: true,
    duplicateSuppressed: false,
    entry,
  };
}
