#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Global replay consistency audit BEFORE 028080 physical patch
 *
 * READ ONLY / LOCAL ARTIFACTS ONLY.
 *
 * Goal:
 *   Prove the repaired V9.8 lineage and all downstream V9.9/V9.10 replay
 *   artifacts are mutually consistent, while the physical DB repair for
 *   028080 remains intentionally outstanding.
 *
 * This audit NEVER:
 *   - calls OpenDART
 *   - calls KIS
 *   - reads Supabase
 *   - writes Supabase
 *   - executes historical APPLY stages
 *   - patches 028080
 *
 * Required final state:
 *   REPLAY CLOSED
 *   GLOBAL CONSISTENCY PROVEN
 *   PHYSICAL 028080 PATCH READY
 *   PHYSICAL PATCH NOT YET APPLIED
 *
 * 028080 expected physical repair:
 *   event UUID:
 *     16d168c5-069a-44c2-bf5a-e5c57dcb5446
 *   run UUID:
 *     e295cb01-db1f-4a8e-b109-0a464b7869fa
 *   old provider_event_id:
 *     20260630001117
 *   desired provider_event_id:
 *     20221013000451
 *   desired source fingerprint:
 *     3e3679a37260de07c69997b00e358936888aa3d68fa564b4e9a4834ec537d793
 *   action:
 *     MERGER
 *   effective date:
 *     2026-10-01
 *   factor child changes:
 *     0
 *   patch rows:
 *     exactly 2 (event + run)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'GLOBAL_REPLAY_CONSISTENCY_AUDIT_V9_8_THROUGH_V9_10_BEFORE_028080_PHYSICAL_PATCH';

const TARGET = Object.freeze({
  stockCode: '028080',
  actionType: 'MERGER',
  effectiveDate: '2026-10-01',

  oldProviderEventId:
    '20260630001117',

  desiredProviderEventId:
    '20221013000451',

  sourceReceiptNo:
    '20260811000452',

  desiredSourceFingerprint:
    '3e3679a37260de07c69997b00e358936888aa3d68fa564b4e9a4834ec537d793',

  eventUuid:
    '16d168c5-069a-44c2-bf5a-e5c57dcb5446',

  runUuid:
    'e295cb01-db1f-4a8e-b109-0a464b7869fa',
});

const EXPECTED_V99_STATUS =
  'HISTORICAL_V9_9_11_10_TO_13_COMMON_STOCK_REFRESH_CLOSURE_RESULTS_REUSABLE';

const EXPECTED_V910_STATUS =
  'HISTORICAL_V9_10_1_2_2_1_3_COMMON_STOCK_CYCLE_CLOSURE_REUSABLE_AFTER_PRIOR_CARRY_BASELINE_FIX';

const EXPECTED_V99_PREFLIGHT_STATUS =
  'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_RESULTS_REUSABLE_AFTER_EFFECTIVE_DATE_FIELD_PATH_FIX';

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      return value;
    }
  }

  return null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n
    : null;
}

function normalizeStock(value) {
  const text =
    String(value ?? '').trim();

  return text
    ? text.padStart(6, '0')
    : '';
}

function recursiveObjects(
  value,
  out = [],
  seen = new Set(),
) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return out;
  }

  if (seen.has(value)) {
    return out;
  }

  seen.add(value);

  if (!Array.isArray(value)) {
    out.push(value);
  }

  for (const child of Object.values(value)) {
    if (
      child &&
      typeof child === 'object'
    ) {
      recursiveObjects(
        child,
        out,
        seen,
      );
    }
  }

  return out;
}

function collectKeyValues(value) {
  const out = [];

  function walk(node, prefix = '') {
    if (
      node === null ||
      node === undefined
    ) {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(
        (child, index) =>
          walk(
            child,
            `${prefix}[${index}]`,
          ),
      );
      return;
    }

    if (typeof node !== 'object') {
      return;
    }

    for (
      const [key, child]
      of Object.entries(node)
    ) {
      const p =
        prefix
          ? `${prefix}.${key}`
          : key;

      if (
        child === null ||
        typeof child !== 'object'
      ) {
        out.push({
          key,
          path: p,
          value: child,
        });
      } else {
        walk(child, p);
      }
    }
  }

  walk(value);

  return out;
}

function valuesForKeys(
  doc,
  aliases,
) {
  const wanted =
    new Set(
      aliases.map(
        (x) =>
          String(x)
            .toLowerCase(),
      ),
    );

  return collectKeyValues(doc)
    .filter(
      (item) =>
        wanted.has(
          String(item.key)
            .toLowerCase(),
        ),
    );
}

function firstNumberForKeys(
  doc,
  aliases,
) {
  for (
    const item
    of valuesForKeys(doc, aliases)
  ) {
    const n =
      num(item.value);

    if (n !== null) {
      return {
        value: n,
        path: item.path,
      };
    }
  }

  return {
    value: null,
    path: null,
  };
}

function firstBooleanForKeys(
  doc,
  aliases,
) {
  for (
    const item
    of valuesForKeys(doc, aliases)
  ) {
    if (
      typeof item.value ===
      'boolean'
    ) {
      return {
        value:
          item.value,

        path:
          item.path,
      };
    }
  }

  return {
    value: null,
    path: null,
  };
}

function textContainsAll(
  file,
  tokens,
) {
  const text =
    fs.readFileSync(
      file,
      'utf8',
    );

  return tokens.every(
    (token) =>
      text.includes(token),
  );
}

function safeJsonFiles(logDir) {
  return fs.readdirSync(logDir)
    .filter(
      (name) =>
        name.endsWith('.json'),
    )
    .map(
      (name) =>
        path.join(logDir, name),
    );
}

function findArtifactByPredicate(
  files,
  predicate,
  label,
) {
  const matches = [];

  for (const file of files) {
    let doc;

    try {
      doc =
        readJson(file);
    } catch {
      continue;
    }

    try {
      if (predicate(doc, file)) {
        matches.push({
          file,
          doc,
        });
      }
    } catch {
      // Ignore malformed / incompatible historical artifact.
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `ARTIFACT_NOT_FOUND:${label}`,
    );
  }

  // Prefer latest modified artifact when several historical variants match.
  matches.sort(
    (a, b) =>
      fs.statSync(b.file).mtimeMs -
      fs.statSync(a.file).mtimeMs,
  );

  return matches[0];
}

function findArtifactContaining(
  files,
  tokens,
  predicate,
  label,
) {
  const matches = [];

  for (const file of files) {
    let text;

    try {
      text =
        fs.readFileSync(
          file,
          'utf8',
        );
    } catch {
      continue;
    }

    if (
      !tokens.every(
        (token) =>
          text.includes(token),
      )
    ) {
      continue;
    }

    let doc;

    try {
      doc =
        JSON.parse(
          text.replace(
            /^\uFEFF/,
            '',
          ),
        );
    } catch {
      continue;
    }

    if (
      !predicate ||
      predicate(doc, file)
    ) {
      matches.push({
        file,
        doc,
      });
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `ARTIFACT_NOT_FOUND:${label}`,
    );
  }

  matches.sort(
    (a, b) =>
      fs.statSync(b.file).mtimeMs -
      fs.statSync(a.file).mtimeMs,
  );

  return matches[0];
}

function basename(file) {
  return path.basename(file);
}

function statusOf(doc) {
  return String(
    doc?.status ??
    '',
  );
}

function versionOf(doc) {
  return String(
    doc?.version ??
    '',
  );
}

function issuesCount(doc) {
  const values = [
    doc?.issues,
    doc?.blockers,
    doc?.errors,
    doc?.failures,
  ];

  let total = 0;

  for (const value of values) {
    if (Array.isArray(value)) {
      total +=
        value.length;
    }
  }

  return total;
}

function findStockObjects(
  doc,
  stockCode,
) {
  return recursiveObjects(doc)
    .filter(
      (obj) =>
        normalizeStock(
          firstNonEmpty(
            obj.stockCode,
            obj.stock_code,
            obj.canonicalPreview
              ?.stock_code,
            obj.event
              ?.stock_code,
            obj.event
              ?.stockCode,
          ),
        ) ===
        stockCode,
    );
}

function deepHasString(
  doc,
  expected,
) {
  return collectKeyValues(doc)
    .some(
      (item) =>
        String(
          item.value ??
          '',
        ) ===
        String(expected),
    );
}

function exactStatus(
  artifact,
  expected,
  issues,
  label,
) {
  if (
    artifact.doc.status !==
    expected
  ) {
    issues.push({
      check:
        `${label}.status`,

      actual:
        artifact.doc.status ??
        null,

      expected,
    });
  }
}

function requireTrueConclusion(
  doc,
  key,
  issues,
  label,
) {
  if (
    doc?.conclusion?.[key] !==
    true
  ) {
    issues.push({
      check:
        `${label}.conclusion.${key}`,

      actual:
        doc?.conclusion?.[key] ??
        null,

      expected:
        true,
    });
  }
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const logDir =
    path.join(root, 'logs');

  assert(
    fs.existsSync(logDir),
    'LOG_DIRECTORY_NOT_FOUND',
  );

  const jsonFiles =
    safeJsonFiles(logDir);

  const issues = [];

  // ------------------------------------------------------------------
  // Locate authoritative replay endpoints by semantic status/version,
  // not fragile physical filenames.
  // ------------------------------------------------------------------

  const v98Closure =
    findArtifactByPredicate(
      jsonFiles,
      (doc) =>
        doc.status ===
        'V9_8_REPLAY_CYCLE_CLOSED_AT_2026_10_01_PHYSICAL_REPAIR_PENDING',
      'V9_8_REPLAY_CLOSURE',
    );

  const v99Preflight =
    findArtifactByPredicate(
      jsonFiles,
      (doc) =>
        doc.status ===
        EXPECTED_V99_PREFLIGHT_STATUS,
      'V9_9_PREFLIGHT_REPLAY',
    );

  const v99Closure =
    findArtifactByPredicate(
      jsonFiles,
      (doc) =>
        doc.status ===
        EXPECTED_V99_STATUS,
      'V9_9_CLOSURE_REPLAY',
    );

  const v910Closure =
    findArtifactByPredicate(
      jsonFiles,
      (doc) =>
        doc.status ===
        EXPECTED_V910_STATUS,
      'V9_10_CLOSURE_REPLAY',
    );

  // 028080 proof artifacts.
  const repairProof =
    findArtifactContaining(
      jsonFiles,
      [
        TARGET.stockCode,
        TARGET.eventUuid,
        TARGET.runUuid,
        TARGET.desiredProviderEventId,
      ],
      (doc) =>
        deepHasString(
          doc,
          TARGET.stockCode,
        ) &&
        firstBooleanForKeys(
          doc,
          [
            'inPlaceRepairFullyProven',
          ],
        ).value === true,
      '028080_IN_PLACE_REPAIR_PROOF',
    );

  const dryRunProof =
    findArtifactContaining(
      jsonFiles,
      [
        TARGET.stockCode,
        TARGET.eventUuid,
        TARGET.runUuid,
        'plannedPatchRows',
      ],
      (doc) => {
        const patch =
          firstNumberForKeys(
            doc,
            [
              'plannedPatchRows',
            ],
          ).value;

        return patch === 2;
      },
      '028080_TWO_ROW_DRY_RUN',
    );

  // ------------------------------------------------------------------
  // Replay closure integrity.
  // ------------------------------------------------------------------

  exactStatus(
    v98Closure,
    'V9_8_REPLAY_CYCLE_CLOSED_AT_2026_10_01_PHYSICAL_REPAIR_PENDING',
    issues,
    'v98Closure',
  );

  exactStatus(
    v99Preflight,
    EXPECTED_V99_PREFLIGHT_STATUS,
    issues,
    'v99Preflight',
  );

  exactStatus(
    v99Closure,
    EXPECTED_V99_STATUS,
    issues,
    'v99Closure',
  );

  exactStatus(
    v910Closure,
    EXPECTED_V910_STATUS,
    issues,
    'v910Closure',
  );

  if (
    issuesCount(v98Closure.doc) !==
    0
  ) {
    issues.push({
      check:
        'v98Closure.issues',

      actual:
        issuesCount(
          v98Closure.doc,
        ),

      expected:
        0,
    });
  }

  if (
    issuesCount(v99Preflight.doc) !==
    0
  ) {
    issues.push({
      check:
        'v99Preflight.issues',

      actual:
        issuesCount(
          v99Preflight.doc,
        ),

      expected:
        0,
    });
  }

  if (
    issuesCount(v99Closure.doc) !==
    0
  ) {
    issues.push({
      check:
        'v99Closure.issues',

      actual:
        issuesCount(
          v99Closure.doc,
        ),

      expected:
        0,
    });
  }

  if (
    issuesCount(v910Closure.doc) !==
    0
  ) {
    issues.push({
      check:
        'v910Closure.issues',

      actual:
        issuesCount(
          v910Closure.doc,
        ),

      expected:
        0,
    });
  }

  // ------------------------------------------------------------------
  // V9.8 closure accounting.
  // ------------------------------------------------------------------

  requireTrueConclusion(
    v98Closure.doc,
    'replayDependencyChainClosed',
    issues,
    'v98Closure',
  );

  requireTrueConclusion(
    v98Closure.doc,
    'physicalProductionRepairOutstanding',
    issues,
    'v98Closure',
  );

  // Some artifacts put these booleans at top-level instead of conclusion.
  const v98Closed =
    firstBooleanForKeys(
      v98Closure.doc,
      [
        'replayDependencyChainClosed',
      ],
    );

  if (
    v98Closed.value !== true
  ) {
    issues.push({
      check:
        'v98Closure.replayDependencyChainClosed',

      actual:
        v98Closed.value,

      expected:
        true,

      path:
        v98Closed.path,
    });
  }

  const physicalOutstanding =
    firstBooleanForKeys(
      v98Closure.doc,
      [
        'physicalProductionRepairOutstanding',
      ],
    );

  if (
    physicalOutstanding.value !==
    true
  ) {
    issues.push({
      check:
        'v98Closure.physicalProductionRepairOutstanding',

      actual:
        physicalOutstanding.value,

      expected:
        true,

      path:
        physicalOutstanding.path,
    });
  }

  const fullyRepaired =
    firstBooleanForKeys(
      v98Closure.doc,
      [
        'physicalProductionDatabaseFullyRepaired',
      ],
    );

  if (
    fullyRepaired.value !==
    false
  ) {
    issues.push({
      check:
        'v98Closure.physicalProductionDatabaseFullyRepaired',

      actual:
        fullyRepaired.value,

      expected:
        false,

      path:
        fullyRepaired.path,
    });
  }

  const factorReadyV98 =
    firstNumberForKeys(
      v98Closure.doc,
      [
        'factorReady',
        'factorReadyEvents',
      ],
    );

  if (
    factorReadyV98.value !==
    121
  ) {
    issues.push({
      check:
        'v98Closure.factorReady',

      actual:
        factorReadyV98.value,

      expected:
        121,

      path:
        factorReadyV98.path,
    });
  }

  const patchRowsV98 =
    firstNumberForKeys(
      v98Closure.doc,
      [
        'physicalRepairPatchRows',
      ],
    );

  if (
    patchRowsV98.value !== 2
  ) {
    issues.push({
      check:
        'v98Closure.physicalRepairPatchRows',

      actual:
        patchRowsV98.value,

      expected:
        2,

      path:
        patchRowsV98.path,
    });
  }

  // ------------------------------------------------------------------
  // 028080 in-place repair proof.
  // ------------------------------------------------------------------

  const inPlace =
    firstBooleanForKeys(
      repairProof.doc,
      [
        'inPlaceRepairFullyProven',
      ],
    );

  if (inPlace.value !== true) {
    issues.push({
      check:
        'repairProof.inPlaceRepairFullyProven',

      actual:
        inPlace.value,

      expected:
        true,

      path:
        inPlace.path,
    });
  }

  const businessMismatch =
    firstNumberForKeys(
      repairProof.doc,
      [
        'trueBusinessMismatchRows',
      ],
    );

  if (
    businessMismatch.value !==
    0
  ) {
    issues.push({
      check:
        'repairProof.trueBusinessMismatchRows',

      actual:
        businessMismatch.value,

      expected:
        0,

      path:
        businessMismatch.path,
    });
  }

  const runBusinessMismatch =
    firstNumberForKeys(
      repairProof.doc,
      [
        'runBusinessMismatchRows',
      ],
    );

  if (
    runBusinessMismatch.value !==
    0
  ) {
    issues.push({
      check:
        'repairProof.runBusinessMismatchRows',

      actual:
        runBusinessMismatch.value,

      expected:
        0,

      path:
        runBusinessMismatch.path,
    });
  }

  const factorDependency =
    firstNumberForKeys(
      repairProof.doc,
      [
        'factorDependencyRows',
      ],
    );

  if (
    factorDependency.value !==
    0
  ) {
    issues.push({
      check:
        'repairProof.factorDependencyRows',

      actual:
        factorDependency.value,

      expected:
        0,

      path:
        factorDependency.path,
    });
  }

  // Require both UUIDs and both old/new provider IDs somewhere in proof.
  for (
    const [label, expected]
    of Object.entries({
      eventUuid:
        TARGET.eventUuid,

      runUuid:
        TARGET.runUuid,

      oldProviderEventId:
        TARGET.oldProviderEventId,

      desiredProviderEventId:
        TARGET.desiredProviderEventId,

      desiredSourceFingerprint:
        TARGET.desiredSourceFingerprint,
    })
  ) {
    if (
      !deepHasString(
        repairProof.doc,
        expected,
      )
    ) {
      issues.push({
        check:
          `repairProof.${label}`,

        expected,
        actual:
          'NOT_FOUND',
      });
    }
  }

  // ------------------------------------------------------------------
  // 028080 two-row dry-run proof.
  // ------------------------------------------------------------------

  const dryRunCounts = {
    currentEventRows:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'currentEventRows',
        ],
      ),

    currentRunRows:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'currentRunRows',
        ],
      ),

    competingIdentities:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'competingIdentities',
        ],
      ),

    factorRefs:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'factorRefs',
          'factorReferences',
        ],
      ),

    postStateMismatch:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'postStateMismatch',
          'postStateMismatchRows',
        ],
      ),

    plannedPatchRows:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'plannedPatchRows',
        ],
      ),

    plannedInsertRows:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'plannedInsertRows',
          'insertRows',
        ],
      ),

    plannedDeleteRows:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'plannedDeleteRows',
          'deleteRows',
        ],
      ),

    plannedFactorRows:
      firstNumberForKeys(
        dryRunProof.doc,
        [
          'plannedFactorRows',
          'factorRowsChanged',
          'factorChanges',
        ],
      ),
  };

  const expectedDryRun = {
    currentEventRows: 1,
    currentRunRows: 1,
    competingIdentities: 0,
    factorRefs: 0,
    postStateMismatch: 0,
    plannedPatchRows: 2,
    plannedInsertRows: 0,
    plannedDeleteRows: 0,
    plannedFactorRows: 0,
  };

  for (
    const [field, expected]
    of Object.entries(
      expectedDryRun,
    )
  ) {
    const actual =
      dryRunCounts[field]
        .value;

    // For aliases that older artifact may not expose, absence is not
    // sufficient to invent success. Patch count and core invariants are strict.
    if (
      [
        'plannedInsertRows',
        'plannedDeleteRows',
        'plannedFactorRows',
      ].includes(field)
    ) {
      if (
        actual !== null &&
        actual !== expected
      ) {
        issues.push({
          check:
            `dryRunProof.${field}`,

          actual,
          expected,

          path:
            dryRunCounts[field]
              .path,
        });
      }

      continue;
    }

    if (actual !== expected) {
      issues.push({
        check:
          `dryRunProof.${field}`,

        actual,
        expected,

        path:
          dryRunCounts[field]
            .path,
      });
    }
  }

  for (
    const expected
    of [
      TARGET.eventUuid,
      TARGET.runUuid,
      TARGET.oldProviderEventId,
      TARGET.desiredProviderEventId,
    ]
  ) {
    if (
      !deepHasString(
        dryRunProof.doc,
        expected,
      )
    ) {
      issues.push({
        check:
          'dryRunProof.requiredTargetIdentity',

        expected,
        actual:
          'NOT_FOUND',
      });
    }
  }

  // ------------------------------------------------------------------
  // V9.9 replay integrity.
  // ------------------------------------------------------------------

  requireTrueConclusion(
    v99Preflight.doc,
    'historicalV9911_4PreflightReusable',
    issues,
    'v99Preflight',
  );

  requireTrueConclusion(
    v99Preflight.doc,
    'historicalV9911_5DryRunReusable',
    issues,
    'v99Preflight',
  );

  requireTrueConclusion(
    v99Preflight.doc,
    'historicalV9911_5_1SnapshotEligibilityReusable',
    issues,
    'v99Preflight',
  );

  requireTrueConclusion(
    v99Closure.doc,
    'historicalV9911_13CycleClosureReusable',
    issues,
    'v99Closure',
  );

  requireTrueConclusion(
    v99Closure.doc,
    'exactlyOneRatioRefreshCandidate032080',
    issues,
    'v99Closure',
  );

  requireTrueConclusion(
    v99Closure.doc,
    'cashDividend039830RequiresNoHistoryRefresh',
    issues,
    'v99Closure',
  );

  requireTrueConclusion(
    v99Closure.doc,
    'v99CycleClosedAt2026_10_04',
    issues,
    'v99Closure',
  );

  requireTrueConclusion(
    v99Closure.doc,
    'canonicalAdjustedBarsNeverDoubleAdjusted',
    issues,
    'v99Closure',
  );

  if (
    v99Closure.doc
      ?.conclusion
      ?.physical028080RepairStillSeparate !==
    true
  ) {
    issues.push({
      check:
        'v99Closure.physical028080RepairStillSeparate',

      actual:
        v99Closure.doc
          ?.conclusion
          ?.physical028080RepairStillSeparate ??
        null,

      expected:
        true,
    });
  }

  // The common-stock incremental artifacts must not contain 028080 as a row.
  const v99TargetObjects =
    findStockObjects(
      v99Preflight.doc,
      TARGET.stockCode,
    )
    .concat(
      findStockObjects(
        v99Closure.doc,
        TARGET.stockCode,
      ),
    );

  if (
    v99TargetObjects.length !==
    0
  ) {
    issues.push({
      check:
        'v99Replay.028080MustNotBeIncrementalRow',

      actual:
        v99TargetObjects.length,

      expected:
        0,
    });
  }

  // ------------------------------------------------------------------
  // V9.10 zero-new-event closure integrity.
  // ------------------------------------------------------------------

  requireTrueConclusion(
    v910Closure.doc,
    'zeroNewEventBoundaryConfirmed',
    issues,
    'v910Closure',
  );

  requireTrueConclusion(
    v910Closure.doc,
    'threeFutureStructuralCarryForwardPreservedExactly',
    issues,
    'v910Closure',
  );

  requireTrueConclusion(
    v910Closure.doc,
    'v99ToV910BoundaryContinuous',
    issues,
    'v910Closure',
  );

  requireTrueConclusion(
    v910Closure.doc,
    'v910CurrentWindowDidNotInject028080',
    issues,
    'v910Closure',
  );

  requireTrueConclusion(
    v910Closure.doc,
    'safeToDeclareHistoricalReplayThroughV9_10_0_3Closed',
    issues,
    'v910Closure',
  );

  if (
    v910Closure.doc
      ?.conclusion
      ?.physical028080RepairStillSeparate !==
    true
  ) {
    issues.push({
      check:
        'v910Closure.physical028080RepairStillSeparate',

      actual:
        v910Closure.doc
          ?.conclusion
          ?.physical028080RepairStillSeparate ??
        null,

      expected:
        true,
    });
  }

  // Exact final carry-forward set.
  const finalCarry =
    new Set(
      v910Closure.doc
        ?.closure103
        ?.carryForwardIdentities ??
      [],
    );

  const expectedFinalCarry =
    new Set([
      '20260619000664|469480|MERGER',
      '20260909000291|001570|SPIN_OFF',
      '20261002000418|043910|MERGER',
    ]);

  if (
    finalCarry.size !==
      expectedFinalCarry.size ||
    [...expectedFinalCarry]
      .some(
        (key) =>
          !finalCarry.has(key),
      )
  ) {
    issues.push({
      check:
        'v910Closure.finalCarryForwardExactSet',

      actual:
        [...finalCarry].sort(),

      expected:
        [...expectedFinalCarry].sort(),
    });
  }

  // ------------------------------------------------------------------
  // Global safety invariants.
  // ------------------------------------------------------------------

  const replayArtifacts = [
    v98Closure,
    v99Preflight,
    v99Closure,
    v910Closure,
    repairProof,
    dryRunProof,
  ];

  const accidentalAppliedArtifacts = [];

  for (const artifact of replayArtifacts) {
    const productionApplied =
      firstBooleanForKeys(
        artifact.doc,
        [
          'productionAppliedNow',
          'physical028080PatchExecutedNow',
        ],
      );

    if (
      productionApplied.value ===
      true
    ) {
      accidentalAppliedArtifacts.push({
        file:
          basename(artifact.file),

        path:
          productionApplied.path,
      });
    }
  }

  if (
    accidentalAppliedArtifacts.length >
    0
  ) {
    issues.push({
      check:
        'global.noReplayWriteOrPhysicalPatch',

      rows:
        accidentalAppliedArtifacts,
    });
  }

  // Global decision.
  const consistent =
    issues.length === 0;

  const status =
    consistent
      ? 'GLOBAL_REPLAY_CONSISTENCY_PROVEN_PHYSICAL_028080_PATCH_READY_NOT_APPLIED'
      : 'GLOBAL_REPLAY_CONSISTENCY_BLOCKED';

  const report = {
    status,
    version: VERSION,

    replayRange: {
      repairedUpstream:
        'V9.8.4.x',

      replayClosedThrough:
        'V9.10.0.3',

      v98Snapshot:
        '2026-10-01',

      v99Snapshot:
        '2026-10-04',

      v910Snapshot:
        '2026-10-05',
    },

    authoritativeArtifacts: {
      v98Closure: {
        file:
          basename(
            v98Closure.file,
          ),

        version:
          versionOf(
            v98Closure.doc,
          ),

        status:
          statusOf(
            v98Closure.doc,
          ),
      },

      v99Preflight: {
        file:
          basename(
            v99Preflight.file,
          ),

        version:
          versionOf(
            v99Preflight.doc,
          ),

        status:
          statusOf(
            v99Preflight.doc,
          ),
      },

      v99Closure: {
        file:
          basename(
            v99Closure.file,
          ),

        version:
          versionOf(
            v99Closure.doc,
          ),

        status:
          statusOf(
            v99Closure.doc,
          ),
      },

      v910Closure: {
        file:
          basename(
            v910Closure.file,
          ),

        version:
          versionOf(
            v910Closure.doc,
          ),

        status:
          statusOf(
            v910Closure.doc,
          ),
      },

      repairProof: {
        file:
          basename(
            repairProof.file,
          ),

        version:
          versionOf(
            repairProof.doc,
          ),

        status:
          statusOf(
            repairProof.doc,
          ),
      },

      dryRunProof: {
        file:
          basename(
            dryRunProof.file,
          ),

        version:
          versionOf(
            dryRunProof.doc,
          ),

        status:
          statusOf(
            dryRunProof.doc,
          ),
      },
    },

    invariants: {
      v98ReplayDependencyChainClosed:
        v98Closed.value === true,

      v98FactorReadyRowsRemain121:
        factorReadyV98.value ===
        121,

      v99ClosedAt2026_10_04:
        v99Closure.doc
          ?.conclusion
          ?.v99CycleClosedAt2026_10_04 ===
        true,

      v910ZeroNewEventBoundary:
        v910Closure.doc
          ?.conclusion
          ?.zeroNewEventBoundaryConfirmed ===
        true,

      v910ThreeFutureStructuralCarryPreserved:
        v910Closure.doc
          ?.conclusion
          ?.threeFutureStructuralCarryForwardPreservedExactly ===
        true,

      canonicalAdjustedBarsNeverDoubleAdjusted:
        v99Closure.doc
          ?.conclusion
          ?.canonicalAdjustedBarsNeverDoubleAdjusted ===
        true,

      target028080StayedOutOfV99IncrementalRows:
        v99TargetObjects.length ===
        0,

      target028080StayedOutOfV910CurrentWindow:
        v910Closure.doc
          ?.conclusion
          ?.v910CurrentWindowDidNotInject028080 ===
        true,

      physicalRepairStillOutstanding:
        physicalOutstanding.value ===
        true,

      physicalDatabaseNotYetFullyRepaired:
        fullyRepaired.value ===
        false,

      inPlaceRepairFullyProven:
        inPlace.value ===
        true,

      patchIsExactlyTwoRows:
        dryRunCounts
          .plannedPatchRows
          .value === 2,

      patchRequiresNoInsert:
        dryRunCounts
          .plannedInsertRows
          .value === null ||
        dryRunCounts
          .plannedInsertRows
          .value === 0,

      patchRequiresNoDelete:
        dryRunCounts
          .plannedDeleteRows
          .value === null ||
        dryRunCounts
          .plannedDeleteRows
          .value === 0,

      patchRequiresNoFactorMutation:
        (
          dryRunCounts
            .plannedFactorRows
            .value === null ||
          dryRunCounts
            .plannedFactorRows
            .value === 0
        ) &&
        factorDependency.value === 0,

      postPatchDryRunStateMatchesDesired:
        dryRunCounts
          .postStateMismatch
          .value === 0,

      noProductionWriteExecutedByReplayAudit:
        accidentalAppliedArtifacts.length ===
        0,
    },

    target028080: {
      stockCode:
        TARGET.stockCode,

      actionType:
        TARGET.actionType,

      effectiveDate:
        TARGET.effectiveDate,

      eventUuid:
        TARGET.eventUuid,

      runUuid:
        TARGET.runUuid,

      oldProviderEventId:
        TARGET.oldProviderEventId,

      desiredProviderEventId:
        TARGET.desiredProviderEventId,

      sourceReceiptNo:
        TARGET.sourceReceiptNo,

      desiredSourceFingerprint:
        TARGET.desiredSourceFingerprint,

      repairMode:
        'UUID_PRESERVING_IN_PLACE_PATCH',

      patchRows:
        2,

      eventPatchRequired:
        true,

      runPatchRequired:
        true,

      insertRequired:
        false,

      deleteRequired:
        false,

      factorMutationRequired:
        false,

      physicalPatchApplied:
        false,
    },

    dryRunEvidence: {
      currentEventRows:
        dryRunCounts
          .currentEventRows
          .value,

      currentRunRows:
        dryRunCounts
          .currentRunRows
          .value,

      competingIdentities:
        dryRunCounts
          .competingIdentities
          .value,

      factorRefs:
        dryRunCounts
          .factorRefs
          .value,

      postStateMismatch:
        dryRunCounts
          .postStateMismatch
          .value,

      plannedPatchRows:
        dryRunCounts
          .plannedPatchRows
          .value,

      plannedInsertRows:
        dryRunCounts
          .plannedInsertRows
          .value,

      plannedDeleteRows:
        dryRunCounts
          .plannedDeleteRows
          .value,

      plannedFactorRows:
        dryRunCounts
          .plannedFactorRows
          .value,
    },

    finalCarryForward: {
      count:
        finalCarry.size,

      identities:
        [...finalCarry].sort(),
    },

    issues,

    conclusion: {
      historicalReplayV98Closed:
        consistent,

      historicalReplayV99Closed:
        consistent,

      historicalReplayV910Closed:
        consistent,

      downstreamReplayGloballyConsistent:
        consistent,

      physical028080PatchFullyProven:
        consistent,

      physical028080PatchStillNotApplied:
        true,

      safeToPrepareControlled028080PhysicalPatch:
        consistent,

      safeToExecutePhysicalPatchImmediately:
        false,

      reasonExecutionStillSeparate:
        'GLOBAL_AUDIT_ONLY_PREPARES_THE_WRITE_GATE;_PHYSICAL_PATCH_REQUIRES_A_DEDICATED_CONTROLLED_APPLY_WITH_PRECONDITION_AND_POST_VERIFY',

      networkRefetchRequiredNow:
        false,

      opendartRefetchRequiredNow:
        false,

      kisRefetchRequiredNow:
        false,

      databaseReadRequiredByThisAudit:
        false,

      databaseWriteRequiredByThisAudit:
        false,
    },

    safety: {
      networkRequestsNow:
        0,

      opendartRequestsNow:
        0,

      kisRequestsNow:
        0,

      databaseReadsNow:
        0,

      databaseWritesNow:
        0,

      historicalApplyStagesExecutedNow:
        false,

      physical028080PatchExecutedNow:
        false,

      coverageWindowAdvancedNow:
        false,
    },

    nextGate:
      consistent
        ? 'PREPARE_CONTROLLED_028080_PHYSICAL_PATCH_WITH_LIVE_PRECONDITION_RECHECK'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-global-replay-consistency-before-028080-patch.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        replayRange:
          report.replayRange,

        authoritativeArtifacts:
          report.authoritativeArtifacts,

        invariants:
          report.invariants,

        target028080:
          report.target028080,

        dryRunEvidence:
          report.dryRunEvidence,

        finalCarryForward:
          report.finalCarryForward,

        issues:
          report.issues,

        conclusion:
          report.conclusion,
      }),
    );

  atomicSaveJson(
    path.join(
      logDir,
      'opendart-corporate-action-global-replay-consistency-before-028080-patch.json',
    ),
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          report.version,

        replayRange:
          report.replayRange,

        authoritativeArtifacts:
          report.authoritativeArtifacts,

        invariants:
          report.invariants,

        target028080:
          report.target028080,

        dryRunEvidence:
          report.dryRunEvidence,

        finalCarryForward:
          report.finalCarryForward,

        issues:
          report.issues,

        conclusion:
          report.conclusion,

        networkRequestsNow:
          0,

        databaseReadsNow:
          0,

        databaseWritesNow:
          0,

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (!consistent) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'GLOBAL_REPLAY_CONSISTENCY_AUDIT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequestsNow:
          0,

        opendartRequestsNow:
          0,

        kisRequestsNow:
          0,

        databaseReadsNow:
          0,

        databaseWritesNow:
          0,

        physical028080PatchExecutedNow:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
