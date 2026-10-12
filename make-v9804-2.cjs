#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.4.1 -> V9.8.4.2 patch builder
 *
 * Purpose:
 * - Keep scripts/v9804-1.cjs untouched.
 * - Create scripts/v9804-2.cjs.
 * - Make top-level `correction` consistent with targetHistoryRow classification.
 * - Preserve the original queue value as `sourceCorrection`.
 * - Use a separate output JSON.
 *
 * Safety:
 * - No network access.
 * - No DB access.
 * - Refuses to overwrite an existing v9804-2.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

const sourceFile = path.join(
  root,
  'scripts',
  'v9804-1.cjs',
);

const targetFile = path.join(
  root,
  'scripts',
  'v9804-2.cjs',
);

function fail(message) {
  console.error(
    `[V9.8.4.2 PATCH ERROR] ${message}`,
  );
  process.exit(1);
}

if (!fs.existsSync(sourceFile)) {
  fail(
    `SOURCE_NOT_FOUND: ${sourceFile}`,
  );
}

if (fs.existsSync(targetFile)) {
  fail(
    `TARGET_ALREADY_EXISTS: ${targetFile}\n` +
    '기존 v9804-2.cjs를 보존하기 위해 덮어쓰지 않았습니다.',
  );
}

let code =
  fs.readFileSync(
    sourceFile,
    'utf8',
  );

const oldVersion =
  "'V9_8_4_1_OPENDART_CORRECTION_PREFIX_CLASSIFICATION_FIX'";

const newVersion =
  "'V9_8_4_2_OPENDART_TARGET_CLASSIFICATION_CONSISTENCY_FIX'";

if (!code.includes(oldVersion)) {
  fail(
    'EXPECTED_V9_8_4_1_VERSION_NOT_FOUND. ' +
    'scripts/v9804-1.cjs가 예상 버전과 다릅니다.',
  );
}

code =
  code.replace(
    oldVersion,
    newVersion,
  );

const oldOutputName =
  'opendart-corporate-action-chain-resolution-v9-8-4-1.json';

const newOutputName =
  'opendart-corporate-action-chain-resolution-v9-8-4-2.json';

if (!code.includes(oldOutputName)) {
  fail(
    'V9_8_4_1_DEFAULT_OUTPUT_NAME_NOT_FOUND.',
  );
}

code =
  code.replaceAll(
    oldOutputName,
    newOutputName,
  );

const oldBlock = `          correction:
            Boolean(
              target.correction,
            ),

          withdrawal:
            Boolean(
              target.withdrawal,
            ),

          otherEntity:
            Boolean(
              target.otherEntity,
            ),`;

const newBlock = `          /*
           * Preserve the queue classification for auditability, but expose
           * the resolver's filing-history classification as the canonical
           * top-level value. This prevents summary counts and downstream
           * consumers from seeing stale V9.8.3-1 metadata when V9.8.4.x
           * reclassifies a filing title.
           */
          sourceCorrection:
            Boolean(
              target.correction,
            ),

          correction:
            resolution
              .targetHistoryRow
              ?.correction ??
            Boolean(
              target.correction,
            ),

          withdrawal:
            resolution
              .targetHistoryRow
              ?.withdrawal ??
            Boolean(
              target.withdrawal,
            ),

          otherEntity:
            resolution
              .targetHistoryRow
              ?.otherEntity ??
            Boolean(
              target.otherEntity,
            ),`;

if (!code.includes(oldBlock)) {
  fail(
    'TARGET_CLASSIFICATION_OUTPUT_BLOCK_NOT_FOUND. ' +
    '자동 패치를 중단했습니다. 원본은 변경되지 않았습니다.',
  );
}

code =
  code.replace(
    oldBlock,
    newBlock,
  );

fs.writeFileSync(
  targetFile,
  code,
  {
    encoding: 'utf8',
    flag: 'wx',
  },
);

console.log(
  JSON.stringify(
    {
      status:
        'PATCH_CREATED',
      sourceFile:
        path
          .relative(
            root,
            sourceFile,
          )
          .replaceAll('\\', '/'),
      targetFile:
        path
          .relative(
            root,
            targetFile,
          )
          .replaceAll('\\', '/'),
      version:
        'V9_8_4_2_OPENDART_TARGET_CLASSIFICATION_CONSISTENCY_FIX',
      changes: [
        'VERSION_UPDATED',
        'TOP_LEVEL_CORRECTION_USES_TARGET_HISTORY_CLASSIFICATION',
        'SOURCE_CORRECTION_PRESERVED',
        'WITHDRAWAL_AND_OTHER_ENTITY_USE_HISTORY_CLASSIFICATION_WITH_FALLBACK',
        'DEFAULT_OUTPUT_FILE_SEPARATED',
      ],
      originalPreserved:
        true,
      networkRequests:
        0,
      databaseWrites:
        0,
    },
    null,
    2,
  ),
);
