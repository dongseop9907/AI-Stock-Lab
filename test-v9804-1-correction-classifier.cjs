#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.4.1 correction-prefix classifier smoke test
 *
 * This file does NOT:
 * - call OpenDART
 * - access Supabase/DB
 * - write project data
 *
 * It only tests the correction-prefix classification logic that was
 * inserted into scripts/v9804-1.cjs.
 */

function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactTitle(value) {
  return normalizeTitle(value)
    .replace(/\s+/g, '');
}

function correctionPrefixInfo(title) {
  const t = compactTitle(title);

  const leadingBracketPrefixes = [];
  let rest = t;

  while (true) {
    const match = rest.match(/^\[([^\]]+)\]/);

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
}

const cases = [
  {
    title: '[기재정정]주요사항보고서(회사합병결정)',
    expectedCorrection: true,
  },
  {
    title: '[첨부정정]주요사항보고서(회사합병결정)',
    expectedCorrection: true,
  },
  {
    title: '[정정]주요사항보고서(회사합병결정)',
    expectedCorrection: true,
  },
  {
    title: '[정정명령부과][기재정정]주요사항보고서(회사합병결정)',
    expectedCorrection: true,
  },
  {
    title: '[정정명령부과][첨부정정]주요사항보고서(회사합병결정)',
    expectedCorrection: true,
  },
  {
    title: '[정정명령부과]주요사항보고서(회사합병결정)',
    expectedCorrection: true,
  },
  {
    title: '주요사항보고서(회사합병결정)',
    expectedCorrection: false,
  },
  {
    title: '현금ㆍ현물배당결정',
    expectedCorrection: false,
  },
  {
    title: '주식병합결정',
    expectedCorrection: false,
  },
];

const results = cases.map(
  (testCase) => {
    const info =
      correctionPrefixInfo(
        testCase.title,
      );

    const actual =
      isCorrection(
        testCase.title,
      );

    return {
      title:
        testCase.title,
      expectedCorrection:
        testCase.expectedCorrection,
      actualCorrection:
        actual,
      pass:
        actual ===
        testCase.expectedCorrection,
      prefixes:
        info.prefixes,
      strippedTitle:
        stripCorrectionPrefix(
          testCase.title,
        ),
    };
  },
);

const failed =
  results.filter(
    (row) =>
      !row.pass,
  );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? 'CLASSIFIER_TEST_PASS'
          : 'CLASSIFIER_TEST_FAIL',
      total:
        results.length,
      passed:
        results.length -
        failed.length,
      failed:
        failed.length,
      results,
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
