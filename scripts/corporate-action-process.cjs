const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();

function parseArgs(argv) {
  const out = { workset: null, tag: null };

  for (const arg of argv) {
    if (arg.startsWith('--workset=')) {
      out.workset = arg.slice('--workset='.length);
    } else if (arg.startsWith('--tag=')) {
      out.tag = arg.slice('--tag='.length);
    }
  }

  return out;
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '')
  );
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });

  fs.writeFileSync(
    file,
    JSON.stringify(value, null, 2) + '\n',
    'utf8'
  );
}

function runStage(name, script, args) {
  console.log(`\n=== ${name} ===`);

  const result = spawnSync(
    process.execPath,
    [script, ...args],
    {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    }
  );

  if (result.error) {
    throw new Error(
      `${name}_SPAWN_ERROR:${result.error.message}`
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `${name}_FAILED_EXIT_${result.status}`
    );
  }
}

const args = parseArgs(
  process.argv.slice(2)
);

if (!args.workset) {
  throw new Error(
    'REQUIRED_ARGUMENT:--workset'
  );
}

const worksetFile =
  path.resolve(root, args.workset);

if (!fs.existsSync(worksetFile)) {
  throw new Error(
    `WORKSET_NOT_FOUND:${worksetFile}`
  );
}

const workset = readJson(worksetFile);

if (workset.status !== 'DETAIL_WORKSET_READY') {
  throw new Error(
    `WORKSET_NOT_READY:${workset.status}`
  );
}

const inContract =
  Number(
    workset.counts
      ?.inCurrentCanonicalContract ??
    0
  );

const tag =
  args.tag ??
  `run-${Date.now()}`;

const runDir =
  path.join(
    root,
    'logs',
    'corporate-action-runtime',
    'processing',
    tag
  );

fs.mkdirSync(runDir, {
  recursive: true
});

const stateFile =
  path.join(runDir, 'state.json');

if (inContract === 0) {
  const state = {
    version:
      'CORPORATE_ACTION_PROCESSOR_V1',
    status:
      'NO_IN_CONTRACT_EVENTS_TO_PROCESS',
    inContract: 0,
    worksetFile:
      path.relative(root, worksetFile)
        .replaceAll('\\', '/'),
    databaseWrites: 0,
    productionApplied: false,
    actionRequired: false,
  };

  saveJson(stateFile, state);

  console.log(
    JSON.stringify(state, null, 2)
  );

  return;
}

/*
 * Compatibility staging:
 *
 * v91002 was derived from the validated v9802 workset
 * structure, but downstream engines still enforce the
 * V9_8_2 version string.
 *
 * Never modify the source workset. Only the staging copy
 * receives the compatibility version.
 */
const compatWorkset =
  structuredClone(workset);

compatWorkset.version =
  'V9_8_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET';

compatWorkset.runtimeCompatibility = {
  originalVersion:
    workset.version,
  processor:
    'CORPORATE_ACTION_PROCESSOR_V1',
  sourceFile:
    path.relative(root, worksetFile)
      .replaceAll('\\', '/'),
};

const p = name =>
  path.join(runDir, name);

const files = {
  workset:
    p('01-workset-v8-compatible.json'),

  evidence:
    p('02-detail-evidence.json'),

  disposition:
    p('03-provider-014-disposition.json'),

  chain:
    p('04-chain.json'),

  precision:
    p('05-chain-precision.json'),

  finalPrecision:
    p('06-chain-final-precision.json'),

  source:
    p('07-canonical-source.json'),

  sourceFixed:
    p('08-canonical-source-withdrawal-accounting.json'),

  fields:
    p('09-field-extraction.json'),

  fieldsText:
    p('10-field-extraction-text-node.json'),

  reverseProbe:
    p('11-reverse-split-probe.json'),

  fieldsRecovered:
    p('12-field-extraction-recovered.json'),

  effective:
    p('13-effective-date-resolution.json'),
};

saveJson(
  files.workset,
  compatWorkset
);

const stages = [];

function execute(
  name,
  script,
  stageArgs
) {
  stages.push({
    name,
    script,
    status: 'RUNNING'
  });

  saveJson(
    stateFile,
    {
      version:
        'CORPORATE_ACTION_PROCESSOR_V1',
      status:
        'RUNNING',
      currentStage: name,
      inContract,
      stages,
      databaseWrites: 0,
      productionApplied: false,
    }
  );

  runStage(
    name,
    script,
    stageArgs
  );

  stages.at(-1).status = 'PASS';
}

/*
 * IMPORTANT:
 * No --apply anywhere in this processor.
 */
try {
  execute(
    'DETAIL_EVIDENCE',
    './scripts/v9903.cjs',
    [
      `--input=${files.workset}`,
      `--output=${files.evidence}`,
      '--refresh',
    ]
  );

  execute(
    'PROVIDER_014_DISPOSITION',
    './scripts/v9803-1.cjs',
    [
      `--input=${files.evidence}`,
      `--output=${files.disposition}`,
    ]
  );

  execute(
    'CHAIN_RESOLUTION',
    './scripts/v9804.cjs',
    [
      `--input=${files.disposition}`,
      `--output=${files.chain}`,
    ]
  );

  execute(
    'CHAIN_PRECISION',
    './scripts/v9804-1.cjs',
    [
      `--chain=${files.chain}`,
      `--evidence=${files.disposition}`,
      `--output=${files.precision}`,
    ]
  );

  execute(
    'CHAIN_FINAL_PRECISION',
    './scripts/v9804-2.cjs',
    [
      `--chain=${files.chain}`,
      `--precision=${files.precision}`,
      `--evidence=${files.disposition}`,
      `--output=${files.finalPrecision}`,
    ]
  );

  execute(
    'CANONICAL_SOURCE_SELECTION',
    './scripts/v9805.cjs',
    [
      `--workset=${files.workset}`,
      `--evidence=${files.disposition}`,
      `--chain=${files.chain}`,
      `--precision=${files.precision}`,
      `--final-precision=${files.finalPrecision}`,
      `--output=${files.source}`,
    ]
  );

  execute(
    'WITHDRAWAL_ACCOUNTING',
    './scripts/v9805-1.cjs',
    [
      `--source=${files.source}`,
      `--workset=${files.workset}`,
      `--chain=${files.chain}`,
      `--precision=${files.precision}`,
      `--final-precision=${files.finalPrecision}`,
      `--output=${files.sourceFixed}`,
    ]
  );

  execute(
    'FIELD_EXTRACTION',
    './scripts/v9806.cjs',
    [
      `--source=${files.sourceFixed}`,
      `--evidence=${files.disposition}`,
      `--output=${files.fields}`,
    ]
  );

  execute(
    'FIELD_TEXT_NODE_EXTRACTION',
    './scripts/v9806-1.cjs',
    [
      `--input=${files.fields}`,
      `--evidence=${files.disposition}`,
      `--output=${files.fieldsText}`,
    ]
  );

  execute(
    'REVERSE_SPLIT_PROBE',
    './scripts/v9806-2.cjs',
    [
      `--input=${files.fieldsText}`,
      `--evidence=${files.disposition}`,
      `--source=${files.sourceFixed}`,
      `--output=${files.reverseProbe}`,
    ]
  );

  execute(
    'FIELD_RECOVERY',
    './scripts/v9806-3.cjs',
    [
      `--input=${files.fieldsText}`,
      `--probe=${files.reverseProbe}`,
      `--output=${files.fieldsRecovered}`,
    ]
  );

  execute(
    'EFFECTIVE_DATE_RESOLUTION',
    './scripts/v9807.cjs',
    [
      `--input=${files.fieldsRecovered}`,
      `--output=${files.effective}`,
    ]
  );

  /*
   * Do not automatically run v9807-2:
   * that stage contains a historical special-case repair.
   *
   * Do not automatically run factor persistence or DB writes.
   */
  const effective =
    readJson(files.effective);

  const finalState = {
    version:
      'CORPORATE_ACTION_PROCESSOR_V1',

    status:
      'EFFECTIVE_DATE_STAGE_COMPLETE_REVIEW_GATE',

    inContract,

    stages,

    effectiveDateStatus:
      effective.status ?? null,

    effectiveDateFile:
      path.relative(root, files.effective)
        .replaceAll('\\', '/'),

    reason:
      'GENERIC_PIPELINE_STOPS_BEFORE_HISTORICAL_V9807_2_SPECIAL_CASE_AND_PRODUCTION_WRITE',

    nextAction:
      'REVIEW_EFFECTIVE_DATE_OUTPUT_THEN_RUN_FACTOR_VALIDATION_IF_GENERICALLY_SAFE',

    databaseWrites: 0,
    productionApplied: false,
    actionRequired: true,
  };

  saveJson(
    stateFile,
    finalState
  );

  console.log(
    '\n' +
    JSON.stringify(
      finalState,
      null,
      2
    )
  );
} catch (error) {
  const failure = {
    version:
      'CORPORATE_ACTION_PROCESSOR_V1',

    status:
      'PROCESSING_REVIEW_REQUIRED',

    inContract,

    failedStage:
      stages.find(
        x => x.status === 'RUNNING'
      )?.name ?? null,

    error:
      error instanceof Error
        ? error.message
        : String(error),

    stages,

    databaseWrites: 0,
    productionApplied: false,

    actionRequired: true,

    nextAction:
      'REVIEW_FAILED_STAGE_DO_NOT_WRITE_PRODUCTION',
  };

  const running =
    stages.find(
      x => x.status === 'RUNNING'
    );

  if (running) {
    running.status = 'FAILED';
  }

  saveJson(
    stateFile,
    failure
  );

  console.error(
    JSON.stringify(
      failure,
      null,
      2
    )
  );

  process.exitCode = 2;
}
