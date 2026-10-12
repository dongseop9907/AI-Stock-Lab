#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.4 PRE-RESOLUTION DIAGNOSTIC
 * 043910 MERGER correction chain evidence audit
 *
 * READ ONLY / NETWORK 0 / DB 0
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_4_043910_CORRECTION_CHAIN_EVIDENCE_DIAGNOSTIC';

const TARGET = Object.freeze({
  corpCode: '00418379',
  stockCode: '043910',
  actionType: 'MERGER',
  correctionReceiptNo: '20261006000033',
  priorReceiptNo: '20261002000418',
});

const RECEIPT_KEY_RE =
  /(rcept|receipt|rcp|report.*no|document.*no|provider.*event|source.*receipt)/i;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeReceipt(v) {
  const s = String(v ?? '').trim();
  return /^\d{14}$/.test(s) ? s : null;
}

function walk(value, visitor, pathParts = []) {
  visitor(value, pathParts);

  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, visitor, [...pathParts, i]));
    return;
  }

  if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      walk(v, visitor, [...pathParts, k]);
    }
  }
}

function valueContainsTarget(v) {
  if (v === null || v === undefined) return false;
  if (typeof v !== 'string' && typeof v !== 'number') return false;

  const s = String(v);
  return (
    s.includes(TARGET.stockCode) ||
    s.includes(TARGET.corpCode) ||
    s.includes(TARGET.correctionReceiptNo) ||
    s.includes(TARGET.priorReceiptNo)
  );
}

function objectLooksTargetLinked(obj) {
  if (!isObject(obj)) return false;
  return Object.values(obj).some(valueContainsTarget);
}

function collectReceiptValues(doc) {
  const out = [];

  walk(doc, (value, parts) => {
    if (parts.length === 0) return;

    const key = String(parts[parts.length - 1]);
    if (!RECEIPT_KEY_RE.test(key)) return;

    if (Array.isArray(value)) {
      for (const x of value) {
        const r = normalizeReceipt(x);
        if (r) out.push({ path: parts.join('.'), key, receiptNo: r });
      }
      return;
    }

    const r = normalizeReceipt(value);
    if (r) out.push({ path: parts.join('.'), key, receiptNo: r });
  });

  const dedup = new Map();
  for (const row of out) {
    const k = `${row.path}|${row.receiptNo}`;
    if (!dedup.has(k)) dedup.set(k, row);
  }

  return [...dedup.values()];
}

function collectTargetObjects(doc, max = 80) {
  const out = [];

  walk(doc, (value, parts) => {
    if (out.length >= max) return;
    if (!isObject(value)) return;
    if (!objectLooksTargetLinked(value)) return;

    out.push({
      path: parts.join('.'),
      value,
    });
  });

  return out;
}

function compactTargetObjects(rows) {
  return rows.map(({ path, value }) => {
    const keep = {};

    for (const [k, v] of Object.entries(value)) {
      if (
        valueContainsTarget(v) ||
        RECEIPT_KEY_RE.test(k) ||
        /stock|corp|action|report|status|gate|reason|correction|withdrawal|effective|date/i.test(k)
      ) {
        keep[k] = v;
      }
    }

    return { path, value: keep };
  });
}

function getFileIfExists(root, rel) {
  const abs = path.join(root, rel);

  return fs.existsSync(abs)
    ? {
        rel,
        abs,
        json: readJson(abs),
      }
    : null;
}

function main() {
  const root = path.resolve(__dirname, '..');

  const candidateFiles = [
    'logs/opendart-corporate-action-workset-carryforward-reconciliation-v9-11-2-1.json',
    'logs/opendart-corporate-action-detail-evidence-v9-11-3.json',
    'logs/opendart-corporate-action-detail-evidence-v9-11-3-1.json',
    'logs/opendart-corporate-action-detail-workset-v9-9-2.json',
    'logs/opendart-corporate-action-workset-carryforward-reconciliation-v9-9-2-1-1.json',
    'logs/opendart-corporate-action-detail-evidence-v9-9-3.json',
    'logs/opendart-corporate-action-detail-evidence-v9-9-3-1.json',
    'logs/opendart-corporate-action-chain-resolution-v9-9-4.json',
    'logs/opendart-corporate-action-canonical-source-selection-v9-9-5.json',
    'logs/opendart-corporate-action-canonical-source-selection-v9-9-5-1.json',
    'logs/opendart-corporate-action-field-extraction-v9-9-6-3.json',
    'logs/opendart-corporate-action-effective-date-finalization-v9-9-7-2.json',
    'logs/opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
    'logs/opendart-corporate-action-cycle-closure-v9-9-11-13-common-stock-scope.json',
    'logs/opendart-corporate-action-cycle-closure-v9-10-3-common-stock-scope.json',
    'logs/opendart-corporate-action-final-post-repair-global-verification.json',
  ];

  const files = candidateFiles
    .map((rel) => getFileIfExists(root, rel))
    .filter(Boolean);

  if (files.length < 3) {
    throw new Error(`INSUFFICIENT_LOCAL_ARTIFACTS:${files.length}`);
  }

  const perFile = [];

  for (const file of files) {
    const receipts = collectReceiptValues(file.json);
    const targetObjects = collectTargetObjects(file.json);

    const serialized = JSON.stringify(file.json);

    perFile.push({
      file: file.rel,
      topStatus: file.json?.status ?? null,
      topVersion: file.json?.version ?? null,
      receiptValues: receipts,
      targetObjects: compactTargetObjects(targetObjects),
      containsCorrectionReceipt:
        serialized.includes(TARGET.correctionReceiptNo),
      containsPriorReceipt:
        serialized.includes(TARGET.priorReceiptNo),
      containsStock:
        serialized.includes(TARGET.stockCode),
    });
  }

  const currentEvidence =
    files.find((f) =>
      f.rel.endsWith(
        'opendart-corporate-action-detail-evidence-v9-11-3.json',
      ),
    )?.json ?? null;

  const disposition =
    files.find((f) =>
      f.rel.endsWith(
        'opendart-corporate-action-detail-evidence-v9-11-3-1.json',
      ),
    )?.json ?? null;

  const reconciliation =
    files.find((f) =>
      f.rel.endsWith(
        'opendart-corporate-action-workset-carryforward-reconciliation-v9-11-2-1.json',
      ),
    )?.json ?? null;

  if (!currentEvidence) throw new Error('CURRENT_EVIDENCE_MISSING');
  if (!disposition) throw new Error('CURRENT_DISPOSITION_MISSING');
  if (!reconciliation) throw new Error('CURRENT_RECONCILIATION_MISSING');

  const currentReceipts = collectReceiptValues(currentEvidence);
  const currentReceiptSet =
    new Set(currentReceipts.map((x) => x.receiptNo));

  const structuredExplicitlyContainsPrior =
    currentReceiptSet.has(TARGET.priorReceiptNo);

  const structuredExplicitlyContainsCorrection =
    currentReceiptSet.has(TARGET.correctionReceiptNo);

  const priorOriginalEvidenceFiles =
    perFile
      .filter(
        (x) =>
          x.containsPriorReceipt &&
          x.containsStock &&
          /v9-9/.test(x.file),
      )
      .map((x) => x.file);

  const currentDispositionQueue =
    Array.isArray(disposition.chainResolutionQueue)
      ? disposition.chainResolutionQueue
      : [];

  const currentQueueRows =
    currentDispositionQueue.filter((row) => {
      const s = JSON.stringify(row);
      return (
        s.includes(TARGET.stockCode) ||
        s.includes(TARGET.correctionReceiptNo)
      );
    });

  const carryMatch =
    reconciliation.overlapAnalysis?.stockActionMatches ?? [];

  const exactPriorCarryMatch =
    Array.isArray(carryMatch) &&
    carryMatch.includes(
      `${TARGET.priorReceiptNo}|${TARGET.stockCode}|${TARGET.actionType}`,
    );

  const mayResolveHighConfidenceWithoutNewNetwork =
    structuredExplicitlyContainsPrior &&
    exactPriorCarryMatch &&
    currentQueueRows.length === 1 &&
    priorOriginalEvidenceFiles.length > 0;

  const diagnostic = {
    status: 'V9_11_4_CHAIN_EVIDENCE_DIAGNOSTIC_COMPLETE',
    version: VERSION,
    target: TARGET,

    localArtifactCount: files.length,

    currentEvidence: {
      status: currentEvidence.status ?? null,
      version: currentEvidence.version ?? null,
      receiptValues: currentReceipts,
      structuredExplicitlyContainsPrior,
      structuredExplicitlyContainsCorrection,
    },

    disposition: {
      status: disposition.status ?? null,
      version: disposition.version ?? null,
      chainResolutionQueueCount:
        currentDispositionQueue.length,
      targetQueueCount:
        currentQueueRows.length,
      targetQueueRows:
        compactTargetObjects(
          currentQueueRows.map((value, i) => ({
            path: `chainResolutionQueue.${i}`,
            value,
          })),
        ),
    },

    carryForwardMatch: {
      exactPriorCarryMatch,
      stockActionMatches: carryMatch,
      classification:
        reconciliation.overlapAnalysis?.classification ?? null,
    },

    priorOriginalEvidence: {
      priorReceiptNo: TARGET.priorReceiptNo,
      evidenceFiles: priorOriginalEvidenceFiles,
      evidenceFileCount: priorOriginalEvidenceFiles.length,
    },

    perFile,

    interpretation: {
      mayResolveHighConfidenceWithoutNewNetwork,
      mayResolveFromCarryMatchAlone: false,
      receiptOrderPairingAllowed: false,
      productionWriteAllowed: false,
      canonicalIdentityAssignmentAllowedNow: false,
    },

    safety: {
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      productionApplied: false,
      factorMutation: false,
    },

    nextGate:
      mayResolveHighConfidenceWithoutNewNetwork
        ? 'BUILD_V9_11_4_HIGH_CONFIDENCE_CHAIN_RESOLUTION_FROM_EXPLICIT_STRUCTURED_AND_PRIOR_CANONICAL_EVIDENCE'
        : 'REVIEW_LOCAL_EVIDENCE_BEFORE_ANY_CHAIN_ASSIGNMENT',

    outputFile:
      'logs/opendart-corporate-action-043910-chain-evidence-diagnostic-v9-11-4.json',
  };

  diagnostic.outputFingerprint =
    sha256(
      JSON.stringify({
        target: diagnostic.target,
        currentEvidence: diagnostic.currentEvidence,
        carryForwardMatch: diagnostic.carryForwardMatch,
        priorOriginalEvidence: diagnostic.priorOriginalEvidence,
        interpretation: diagnostic.interpretation,
      }),
    );

  const outputFile = path.join(root, diagnostic.outputFile);
  atomicSaveJson(outputFile, diagnostic);

  console.log(
    JSON.stringify(
      {
        status: diagnostic.status,
        version: diagnostic.version,
        target: diagnostic.target,
        currentEvidence: {
          receiptValues:
            diagnostic.currentEvidence.receiptValues,
          structuredExplicitlyContainsPrior:
            diagnostic.currentEvidence.structuredExplicitlyContainsPrior,
          structuredExplicitlyContainsCorrection:
            diagnostic.currentEvidence.structuredExplicitlyContainsCorrection,
        },
        disposition: {
          chainResolutionQueueCount:
            diagnostic.disposition.chainResolutionQueueCount,
          targetQueueCount:
            diagnostic.disposition.targetQueueCount,
        },
        carryForwardMatch:
          diagnostic.carryForwardMatch,
        priorOriginalEvidence:
          diagnostic.priorOriginalEvidence,
        interpretation:
          diagnostic.interpretation,
        networkRequests: 0,
        databaseWrites: 0,
        nextGate: diagnostic.nextGate,
        outputFile: diagnostic.outputFile,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: 'V9_11_4_CHAIN_EVIDENCE_DIAGNOSTIC_FAILED',
        version: VERSION,
        error: String(error?.message ?? error),
        networkRequests: 0,
        databaseWrites: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
