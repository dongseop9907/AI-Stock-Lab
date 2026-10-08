#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.4 -> V9.8.4.1 patch builder
 *
 * Purpose:
 * - Keep scripts/v9804.cjs untouched.
 * - Create scripts/v9804-1.cjs from the local original.
 * - Fix stacked correction-prefix classification such as:
 *     [정정명령부과][기재정정]...
 *     [정정명령부과][첨부정정]...
 * - Update VERSION and default output filename.
 *
 * Safety:
 * - No network access.
 * - No DB access.
 * - Refuses to overwrite an existing v9804-1.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const sourceFile = path.join(root, 'scripts', 'v9804.cjs');
const targetFile = path.join(root, 'scripts', 'v9804-1.cjs');

function fail(message) {
  console.error(`[V9.8.4.1 PATCH ERROR] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(sourceFile)) {
  fail(`SOURCE_NOT_FOUND: ${sourceFile}`);
}

if (fs.existsSync(targetFile)) {
  fail(
    `TARGET_ALREADY_EXISTS: ${targetFile}\n` +
    '기존 v9804-1.cjs를 보존하기 위해 덮어쓰지 않았습니다.'
  );
}

let code = fs.readFileSync(sourceFile, 'utf8');

const expectedVersion =
  "'V9_8_4_OPENDART_CORRECTION_WITHDRAWAL_CHAIN_RESOLVER'";

if (!code.includes(expectedVersion)) {
  fail(
    'EXPECTED_V9_8_4_VERSION_NOT_FOUND. ' +
    '현재 scripts/v9804.cjs가 우리가 검사한 V9.8.4와 다른 버전일 수 있습니다.'
  );
}

code = code.replace(
  expectedVersion,
  "'V9_8_4_1_OPENDART_CORRECTION_PREFIX_CLASSIFICATION_FIX'"
);

const oldClassifierBlock = `function stripCorrectionPrefix(title) {
  return compactTitle(title)
    .replace(
      /^\\[(?:기재|첨부)?정정\\]/,
      '',
    )
    .replace(
      /^(?:기재|첨부)?정정/,
      '',
    );
}

function isCorrection(title) {
  const t = compactTitle(title);

  return (
    /^\\[(?:기재|첨부)?정정\\]/.test(t) ||
    /^(?:기재|첨부)?정정/.test(t)
  );
}`;

const newClassifierBlock = `function correctionPrefixInfo(title) {
  const t = compactTitle(title);

  /*
   * OpenDART can stack correction-related prefixes, for example:
   *
   *   [기재정정]...
   *   [첨부정정]...
   *   [정정]...
   *   [정정명령부과][기재정정]...
   *   [정정명령부과][첨부정정]...
   *
   * Only leading prefix tokens are inspected so an unrelated "정정"
   * appearing later in the title does not automatically classify the
   * disclosure as a correction.
   */
  const leadingBracketPrefixes = [];
  let rest = t;

  while (true) {
    const match = rest.match(/^\\[([^\\]]+)\\]/);

    if (!match) {
      break;
    }

    leadingBracketPrefixes.push(
      match[1],
    );

    rest = rest.slice(
      match[0].length,
    );
  }

  const correction =
    leadingBracketPrefixes.some(
      (prefix) =>
        /(?:기재정정|첨부정정|정정명령부과|정정)/.test(
          prefix,
        ),
    ) ||
    /^(?:기재|첨부)?정정/.test(
      rest,
    );

  return {
    correction,
    prefixes:
      leadingBracketPrefixes,
    strippedTitle:
      rest.replace(
        /^(?:기재|첨부)?정정/,
        '',
      ),
  };
}

function stripCorrectionPrefix(title) {
  return correctionPrefixInfo(
    title,
  ).strippedTitle;
}

function isCorrection(title) {
  return correctionPrefixInfo(
    title,
  ).correction;
}`;

if (!code.includes(oldClassifierBlock)) {
  fail(
    'CLASSIFIER_BLOCK_NOT_FOUND. ' +
    '자동 패치를 중단했습니다. 원본을 손상시키지 않았습니다.'
  );
}

code = code.replace(
  oldClassifierBlock,
  newClassifierBlock
);

const oldOutputName =
  'opendart-corporate-action-chain-resolution-v9-8-4.json';

if (!code.includes(oldOutputName)) {
  fail(
    'DEFAULT_OUTPUT_NAME_NOT_FOUND. ' +
    '자동 패치를 중단했습니다.'
  );
}

code = code.replaceAll(
  oldOutputName,
  'opendart-corporate-action-chain-resolution-v9-8-4-1.json'
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
      status: 'PATCH_CREATED',
      sourceFile: path.relative(root, sourceFile).replaceAll('\\', '/'),
      targetFile: path.relative(root, targetFile).replaceAll('\\', '/'),
      version: 'V9_8_4_1_OPENDART_CORRECTION_PREFIX_CLASSIFICATION_FIX',
      changes: [
        'VERSION_UPDATED',
        'STACKED_CORRECTION_PREFIX_CLASSIFICATION_FIXED',
        'DEFAULT_OUTPUT_FILE_SEPARATED',
      ],
      originalPreserved: true,
      networkRequests: 0,
      databaseWrites: 0,
    },
    null,
    2,
  ),
);
