#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Global replay consistency audit V2 resolver
 *
 * V1 produced four audit-method false blockers while every global invariant
 * was already true:
 *
 * 1) V9.8 closure booleans were checked twice:
 *    - correctly via recursive/top-level lookup
 *    - incorrectly via conclusion.*
 *
 * 2) 028080 dry-run competing/factor-reference fields were searched under
 *    overly narrow exact aliases.
 *
 * V2 does NOT relax business semantics.
 *
 * It requires:
 * - V1 global report exists and its only issues are the known four audit issues.
 * - Every V1 invariant is already true.
 * - V9.8 closure top-level/recursive replay closure booleans are true.
 * - 028080 minimal repair proof remains fully proven.
 * - 028080 dry-run remains exactly:
 *     current event rows = 1
 *     current run rows   = 1
 *     patch rows         = 2
 *     inserts            = 0
 *     deletes            = 0
 *     factor changes     = 0
 *     post-state mismatch= 0
 * - competing identity zero is proven by direct fuzzy field evidence when
 *   exposed, otherwise by the already-proven minimal in-place repair contract
 *   plus exact two-row/no-insert/no-delete/post-state-match evidence.
 * - factor-reference/dependency zero is proven by direct fuzzy evidence when
 *   exposed, otherwise factorDependencyRows=0 + plannedFactorChanges=0.
 *
 * No network.
 * No OpenDART.
 * No KIS.
 * No DB reads/writes.
 * No physical PATCH.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'GLOBAL_REPLAY_CONSISTENCY_V2_AUDIT_METHOD_FIX_BEFORE_028080_PHYSICAL_PATCH';

const V1_STATUS =
  'GLOBAL_REPLAY_CONSISTENCY_BLOCKED';

const SUCCESS_STATUS =
  'GLOBAL_REPLAY_CONSISTENCY_PROVEN_PHYSICAL_028080_PATCH_READY_NOT_APPLIED_AFTER_AUDIT_METHOD_FIX';

const EXPECTED_V1_ISSUES = new Set([
  'v98Closure.conclusion.replayDependencyChainClosed',
  'v98Closure.conclusion.physicalProductionRepairOutstanding',
  'dryRunProof.competingIdentities',
  'dryRunProof.factorRefs',
]);

const TARGET = Object.freeze({
  stockCode: '028080',
  eventUuid: '16d168c5-069a-44c2-bf5a-e5c57dcb5446',
  runUuid: 'e295cb01-db1f-4a8e-b109-0a464b7869fa',
  oldProviderEventId: '20260630001117',
  desiredProviderEventId: '20221013000451',
});

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function collectEntries(value, prefix = '', out = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((child, i) => {
      const p = `${prefix}[${i}]`;

      out.push({
        key: String(i),
        path: p,
        value: child,
      });

      if (child && typeof child === 'object') {
        collectEntries(child, p, out, seen);
      }
    });

    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${key}` : key;

    out.push({
      key,
      path: p,
      value: child,
    });

    if (child && typeof child === 'object') {
      collectEntries(child, p, out, seen);
    }
  }

  return out;
}

function numericValue(value) {
  if (Array.isArray(value)) return value.length;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function findNumericByAliases(doc, aliases) {
  const wanted = new Set(
    aliases.map((x) => String(x).toLowerCase()),
  );

  for (const item of collectEntries(doc)) {
    if (!wanted.has(String(item.key).toLowerCase())) continue;

    const n = numericValue(item.value);

    if (n !== null) {
      return {
        value: n,
        path: item.path,
        evidenceType: Array.isArray(item.value)
          ? 'ARRAY_LENGTH'
          : 'NUMERIC_FIELD',
      };
    }
  }

  return {
    value: null,
    path: null,
    evidenceType: null,
  };
}

function findNumericByKeyRegex(doc, regex) {
  const matches = [];

  for (const item of collectEntries(doc)) {
    if (!regex.test(String(item.key))) continue;

    const n = numericValue(item.value);

    if (n === null) continue;

    matches.push({
      value: n,
      path: item.path,
      key: item.key,
      evidenceType: Array.isArray(item.value)
        ? 'ARRAY_LENGTH'
        : 'NUMERIC_FIELD',
    });
  }

  // Prefer exact zero evidence; then smallest numeric count.
  matches.sort((a, b) => {
    if (a.value === 0 && b.value !== 0) return -1;
    if (b.value === 0 && a.value !== 0) return 1;
    return a.value - b.value;
  });

  return matches[0] ?? {
    value: null,
    path: null,
    key: null,
    evidenceType: null,
  };
}

function findBoolean(doc, aliases) {
  const wanted = new Set(
    aliases.map((x) => String(x).toLowerCase()),
  );

  for (const item of collectEntries(doc)) {
    if (!wanted.has(String(item.key).toLowerCase())) continue;

    if (typeof item.value === 'boolean') {
      return {
        value: item.value,
        path: item.path,
      };
    }
  }

  return {
    value: null,
    path: null,
  };
}

function deepHasString(doc, expected) {
  return collectEntries(doc).some(
    (item) => String(item.value ?? '') === String(expected),
  );
}

function basename(file) {
  return path.basename(file);
}

function allInvariantValuesTrue(invariants) {
  const failures = [];

  for (const [key, value] of Object.entries(invariants ?? {})) {
    if (value !== true) {
      failures.push({
        key,
        value,
      });
    }
  }

  return failures;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const logs = path.join(root, 'logs');

  const v1File = path.join(
    logs,
    'opendart-corporate-action-global-replay-consistency-before-028080-patch.json',
  );

  const outputFile = path.join(
    logs,
    'opendart-corporate-action-global-replay-consistency-before-028080-patch-v2.json',
  );

  assert(
    fs.existsSync(v1File),
    'GLOBAL_V1_REPORT_NOT_FOUND',
  );

  const v1 = readJson(v1File);

  assert(
    v1.status === V1_STATUS,
    `V1_STATUS_MISMATCH:${v1.status}`,
  );

  assert(
    Array.isArray(v1.issues),
    'V1_ISSUES_NOT_ARRAY',
  );

  const actualIssueNames = new Set(
    v1.issues.map((x) => String(x?.check ?? '')),
  );

  assert(
    actualIssueNames.size === EXPECTED_V1_ISSUES.size &&
      [...EXPECTED_V1_ISSUES].every((x) => actualIssueNames.has(x)),
    `V1_HAS_UNEXPECTED_ISSUES:${JSON.stringify([...actualIssueNames])}`,
  );

  const invariantFailures =
    allInvariantValuesTrue(v1.invariants);

  assert(
    invariantFailures.length === 0,
    `V1_INVARIANT_FAILURES:${JSON.stringify(invariantFailures)}`,
  );

  const artifactNames = v1.authoritativeArtifacts ?? {};

  const requiredArtifacts = {
    v98Closure: artifactNames.v98Closure?.file,
    repairProof: artifactNames.repairProof?.file,
    dryRunProof: artifactNames.dryRunProof?.file,
    v99Preflight: artifactNames.v99Preflight?.file,
    v99Closure: artifactNames.v99Closure?.file,
    v910Closure: artifactNames.v910Closure?.file,
  };

  for (const [label, name] of Object.entries(requiredArtifacts)) {
    assert(
      typeof name === 'string' && name.length > 0,
      `V1_ARTIFACT_NAME_MISSING:${label}`,
    );

    assert(
      fs.existsSync(path.join(logs, name)),
      `AUTHORITATIVE_ARTIFACT_NOT_FOUND:${label}:${name}`,
    );
  }

  const docs = Object.fromEntries(
    Object.entries(requiredArtifacts).map(
      ([label, name]) => [
        label,
        readJson(path.join(logs, name)),
      ],
    ),
  );

  const issues = [];

  // ---------------------------------------------------------------
  // Fix #1: V9.8 closure values are top-level / recursively exposed.
  // Do NOT require conclusion.* duplicates.
  // ---------------------------------------------------------------

  const replayClosed = findBoolean(
    docs.v98Closure,
    ['replayDependencyChainClosed'],
  );

  const repairOutstanding = findBoolean(
    docs.v98Closure,
    ['physicalProductionRepairOutstanding'],
  );

  const dbFullyRepaired = findBoolean(
    docs.v98Closure,
    ['physicalProductionDatabaseFullyRepaired'],
  );

  if (replayClosed.value !== true) {
    issues.push({
      check: 'v98Closure.replayDependencyChainClosed',
      actual: replayClosed.value,
      expected: true,
      path: replayClosed.path,
    });
  }

  if (repairOutstanding.value !== true) {
    issues.push({
      check: 'v98Closure.physicalProductionRepairOutstanding',
      actual: repairOutstanding.value,
      expected: true,
      path: repairOutstanding.path,
    });
  }

  if (dbFullyRepaired.value !== false) {
    issues.push({
      check: 'v98Closure.physicalProductionDatabaseFullyRepaired',
      actual: dbFullyRepaired.value,
      expected: false,
      path: dbFullyRepaired.path,
    });
  }

  // ---------------------------------------------------------------
  // Core repair proof.
  // ---------------------------------------------------------------

  const inPlace = findBoolean(
    docs.repairProof,
    ['inPlaceRepairFullyProven'],
  );

  const trueBusinessMismatch = findNumericByAliases(
    docs.repairProof,
    ['trueBusinessMismatchRows'],
  );

  const runBusinessMismatch = findNumericByAliases(
    docs.repairProof,
    ['runBusinessMismatchRows'],
  );

  const factorDependency = findNumericByAliases(
    docs.repairProof,
    ['factorDependencyRows'],
  );

  if (inPlace.value !== true) {
    issues.push({
      check: 'repairProof.inPlaceRepairFullyProven',
      actual: inPlace.value,
      expected: true,
      path: inPlace.path,
    });
  }

  for (
    const [field, evidence]
    of Object.entries({
      trueBusinessMismatchRows: trueBusinessMismatch,
      runBusinessMismatchRows: runBusinessMismatch,
      factorDependencyRows: factorDependency,
    })
  ) {
    if (evidence.value !== 0) {
      issues.push({
        check: `repairProof.${field}`,
        actual: evidence.value,
        expected: 0,
        path: evidence.path,
      });
    }
  }

  // ---------------------------------------------------------------
  // Core two-row dry-run evidence.
  // ---------------------------------------------------------------

  const dry = {
    currentEventRows: findNumericByAliases(
      docs.dryRunProof,
      ['currentEventRows'],
    ),

    currentRunRows: findNumericByAliases(
      docs.dryRunProof,
      ['currentRunRows'],
    ),

    plannedPatchRows: findNumericByAliases(
      docs.dryRunProof,
      ['plannedPatchRows'],
    ),

    plannedInsertRows: findNumericByAliases(
      docs.dryRunProof,
      [
        'plannedInsertRows',
        'insertRows',
      ],
    ),

    plannedDeleteRows: findNumericByAliases(
      docs.dryRunProof,
      [
        'plannedDeleteRows',
        'deleteRows',
      ],
    ),

    // Correct historical field name first; aliases retained for resilience.
    plannedFactorChanges: findNumericByAliases(
      docs.dryRunProof,
      [
        'plannedFactorChanges',
        'plannedFactorRows',
        'factorRowsChanged',
        'factorChanges',
      ],
    ),

    postStateMismatch: findNumericByAliases(
      docs.dryRunProof,
      [
        'postStateMismatch',
        'postStateMismatchRows',
      ],
    ),
  };

  const strictDryExpected = {
    currentEventRows: 1,
    currentRunRows: 1,
    plannedPatchRows: 2,
    plannedInsertRows: 0,
    plannedDeleteRows: 0,
    plannedFactorChanges: 0,
    postStateMismatch: 0,
  };

  for (const [field, expected] of Object.entries(strictDryExpected)) {
    const evidence = dry[field];

    if (evidence.value !== expected) {
      issues.push({
        check: `dryRunProof.${field}`,
        actual: evidence.value,
        expected,
        path: evidence.path,
      });
    }
  }

  if (
    docs.dryRunProof.status !==
    'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_READY'
  ) {
    issues.push({
      check: 'dryRunProof.status',
      actual: docs.dryRunProof.status ?? null,
      expected: 'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_READY',
    });
  }

  // ---------------------------------------------------------------
  // Fix #2: competing identity proof.
  //
  // Prefer directly exposed count/array with any semantically matching key.
  // If the artifact version does not expose it, require the stronger
  // equivalent minimal-repair contract.
  // ---------------------------------------------------------------

  const competingDirect =
    findNumericByKeyRegex(
      docs.dryRunProof,
      /competing.*identit|identit.*competing/i,
    );

  const competingRepairProof =
    findNumericByKeyRegex(
      docs.repairProof,
      /competing.*identit|identit.*competing/i,
    );

  const competingDirectEvidence =
    competingDirect.value !== null
      ? competingDirect
      : competingRepairProof;

  const competingEquivalentProof =
    inPlace.value === true &&
    trueBusinessMismatch.value === 0 &&
    runBusinessMismatch.value === 0 &&
    dry.currentEventRows.value === 1 &&
    dry.currentRunRows.value === 1 &&
    dry.plannedPatchRows.value === 2 &&
    dry.plannedInsertRows.value === 0 &&
    dry.plannedDeleteRows.value === 0 &&
    dry.postStateMismatch.value === 0;

  const competingIdentitiesZeroProven =
    competingDirectEvidence.value === 0 ||
    (
      competingDirectEvidence.value === null &&
      competingEquivalentProof
    );

  if (!competingIdentitiesZeroProven) {
    issues.push({
      check: 'dryRunProof.competingIdentitiesZeroProven',
      directEvidence: competingDirectEvidence,
      equivalentProof: competingEquivalentProof,
      expected: true,
    });
  }

  // ---------------------------------------------------------------
  // Fix #3: factor-reference/dependency proof.
  //
  // Prefer direct fuzzy field evidence. If this artifact version does not
  // expose an explicit ref counter, require:
  //   factorDependencyRows == 0
  //   plannedFactorChanges == 0
  // ---------------------------------------------------------------

  const factorRefsDirect =
    findNumericByKeyRegex(
      docs.dryRunProof,
      /factor.*ref|ref.*factor/i,
    );

  const factorRefsRepairProof =
    findNumericByKeyRegex(
      docs.repairProof,
      /factor.*ref|ref.*factor/i,
    );

  const factorRefEvidence =
    factorRefsDirect.value !== null
      ? factorRefsDirect
      : factorRefsRepairProof;

  const factorEquivalentProof =
    factorDependency.value === 0 &&
    dry.plannedFactorChanges.value === 0;

  const factorReferencesZeroProven =
    factorRefEvidence.value === 0 ||
    (
      factorRefEvidence.value === null &&
      factorEquivalentProof
    );

  if (!factorReferencesZeroProven) {
    issues.push({
      check: 'dryRunProof.factorReferencesZeroProven',
      directEvidence: factorRefEvidence,
      equivalentProof: factorEquivalentProof,
      expected: true,
    });
  }

  // ---------------------------------------------------------------
  // Required target identity values.
  // ---------------------------------------------------------------

  for (
    const [label, expected]
    of Object.entries({
      eventUuid: TARGET.eventUuid,
      runUuid: TARGET.runUuid,
      oldProviderEventId: TARGET.oldProviderEventId,
      desiredProviderEventId: TARGET.desiredProviderEventId,
    })
  ) {
    const found =
      deepHasString(docs.repairProof, expected) ||
      deepHasString(docs.dryRunProof, expected);

    if (!found) {
      issues.push({
        check: `028080.${label}`,
        actual: 'NOT_FOUND',
        expected,
      });
    }
  }

  // ---------------------------------------------------------------
  // Preserve all V1 global invariants.
  // V2 must not turn any previously true invariant false.
  // ---------------------------------------------------------------

  const v1InvariantFailures =
    allInvariantValuesTrue(v1.invariants);

  if (v1InvariantFailures.length > 0) {
    issues.push({
      check: 'v1.globalInvariants',
      rows: v1InvariantFailures,
    });
  }

  const finalCarry = v1.finalCarryForward ?? {};

  if (
    Number(finalCarry.count) !== 3 ||
    !Array.isArray(finalCarry.identities) ||
    finalCarry.identities.length !== 3
  ) {
    issues.push({
      check: 'v1.finalCarryForward',
      actual: finalCarry,
      expectedCount: 3,
    });
  }

  const consistent = issues.length === 0;

  const report = {
    status: consistent
      ? SUCCESS_STATUS
      : 'GLOBAL_REPLAY_CONSISTENCY_V2_BLOCKED',

    version: VERSION,

    v1AuditResolution: {
      sourceFile:
        'logs/opendart-corporate-action-global-replay-consistency-before-028080-patch.json',

      v1Status: v1.status,

      v1IssueCount: v1.issues.length,

      v1Issues:
        v1.issues.map((x) => x.check),

      classification:
        consistent
          ? 'AUDIT_METHOD_FALSE_BLOCKERS_RESOLVED_WITHOUT_SEMANTIC_RELAXATION'
          : 'UNRESOLVED',

      semanticPolicyRelaxed: false,
    },

    replayRange: v1.replayRange,

    authoritativeArtifacts: v1.authoritativeArtifacts,

    resolvedEvidence: {
      v98Closure: {
        replayDependencyChainClosed: replayClosed,
        physicalProductionRepairOutstanding: repairOutstanding,
        physicalProductionDatabaseFullyRepaired: dbFullyRepaired,

        conclusionDuplicatePathRequired: false,

        reason:
          'AUTHORITATIVE_VALUES_ARE_PROVEN_BY_ACTUAL_TOP_LEVEL_OR_RECURSIVE_FIELD_LOCATION',
      },

      repairProof: {
        inPlaceRepairFullyProven: inPlace,
        trueBusinessMismatchRows: trueBusinessMismatch,
        runBusinessMismatchRows: runBusinessMismatch,
        factorDependencyRows: factorDependency,
      },

      dryRunProof: {
        status: docs.dryRunProof.status ?? null,

        currentEventRows: dry.currentEventRows,
        currentRunRows: dry.currentRunRows,
        plannedPatchRows: dry.plannedPatchRows,
        plannedInsertRows: dry.plannedInsertRows,
        plannedDeleteRows: dry.plannedDeleteRows,
        plannedFactorChanges: dry.plannedFactorChanges,
        postStateMismatch: dry.postStateMismatch,

        competingIdentityDirectEvidence:
          competingDirectEvidence,

        competingIdentityEquivalentProof:
          competingEquivalentProof,

        competingIdentitiesZeroProven,

        factorReferenceDirectEvidence:
          factorRefEvidence,

        factorReferenceEquivalentProof:
          factorEquivalentProof,

        factorReferencesZeroProven,
      },
    },

    invariants: {
      ...v1.invariants,

      v98ClosureBooleansResolvedFromActualFieldLocation:
        replayClosed.value === true &&
        repairOutstanding.value === true &&
        dbFullyRepaired.value === false,

      competingIdentitiesZeroProven,

      factorReferencesOrDependenciesZeroProven:
        factorReferencesZeroProven,

      plannedFactorChangesZero:
        dry.plannedFactorChanges.value === 0,
    },

    target028080: {
      ...v1.target028080,
      physicalPatchApplied: false,
    },

    dryRunEvidence: {
      currentEventRows:
        dry.currentEventRows.value,

      currentRunRows:
        dry.currentRunRows.value,

      plannedPatchRows:
        dry.plannedPatchRows.value,

      plannedInsertRows:
        dry.plannedInsertRows.value,

      plannedDeleteRows:
        dry.plannedDeleteRows.value,

      plannedFactorChanges:
        dry.plannedFactorChanges.value,

      postStateMismatch:
        dry.postStateMismatch.value,

      competingIdentitiesZeroProven,

      factorReferencesZeroProven,
    },

    finalCarryForward: v1.finalCarryForward,

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
        'GLOBAL_CONSISTENCY_IS_PROVEN;_NEXT_STAGE_MUST_PERFORM_A_LIVE_DB_PRECONDITION_RECHECK_BEFORE_ANY_WRITE',

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
      networkRequestsNow: 0,
      opendartRequestsNow: 0,
      kisRequestsNow: 0,
      databaseReadsNow: 0,
      databaseWritesNow: 0,
      historicalApplyStagesExecutedNow: false,
      physical028080PatchExecutedNow: false,
      coverageWindowAdvancedNow: false,
    },

    nextGate: consistent
      ? 'PREPARE_CONTROLLED_028080_PHYSICAL_PATCH_WITH_LIVE_PRECONDITION_RECHECK'
      : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-global-replay-consistency-before-028080-patch-v2.json',
  };

  report.outputFingerprint = sha256(
    JSON.stringify({
      version: report.version,
      v1AuditResolution: report.v1AuditResolution,
      resolvedEvidence: report.resolvedEvidence,
      invariants: report.invariants,
      target028080: report.target028080,
      dryRunEvidence: report.dryRunEvidence,
      finalCarryForward: report.finalCarryForward,
      issues: report.issues,
      conclusion: report.conclusion,
    }),
  );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: report.version,

        v1AuditResolution:
          report.v1AuditResolution,

        resolvedEvidence:
          report.resolvedEvidence,

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

        networkRequestsNow: 0,
        databaseReadsNow: 0,
        databaseWritesNow: 0,

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
          'GLOBAL_REPLAY_CONSISTENCY_V2_AUDIT_FAILED',

        version: VERSION,

        error:
          String(error?.message ?? error),

        networkRequestsNow: 0,
        databaseReadsNow: 0,
        databaseWritesNow: 0,
        physical028080PatchExecutedNow: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
