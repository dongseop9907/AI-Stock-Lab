const fs = require("fs");
const path = require("path");

const root = process.cwd();

const readerRel =
  "lib/trading/data-freshness-canonical-reader.ts";

const installerRel =
  "scripts/install-alpha-v3-data-freshness-canonical-reader-v1.cjs";

function read(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    throw new Error(`FILE_NOT_FOUND ${rel}`);
  }

  return fs.readFileSync(file, "utf8");
}

function write(rel, text) {
  fs.writeFileSync(
    path.resolve(root, rel),
    text,
    "utf8"
  );
}

function patchReaderSource(source) {
  let text = source;

  text = text.replace(
    /type QueryChain<T> = \{[\s\S]*?\n\};\n\nexport interface DataFreshnessSupabaseLike \{[\s\S]*?\n\}/m,
    `export interface DataFreshnessSupabaseLike {
  from(
    table:
      string,
  ): any;
}`
  );

  text = text.replaceAll(
    ".from<FreshnessObservationRow>(",
    ".from("
  );

  text = text.replaceAll(
    ".from<QualityGateObservationRow>(",
    ".from("
  );

  return text;
}

/*
 * Runtime reader is already the authoritative production artifact.
 * Verify/normalize it first.
 */
const readerBefore = read(readerRel);
const readerAfter =
  patchReaderSource(readerBefore);

write(readerRel, readerAfter);

/*
 * The installer stores the generated reader as a JSON string inside
 * the outputs array. Decode that exact string, patch the decoded TS,
 * then JSON.stringify it back. This avoids brittle escape-level regexes.
 */
const installerBefore =
  read(installerRel);

const objectRegex =
  /(rel:\s*"lib\/trading\/data-freshness-canonical-reader\.ts"\s*,\s*text:\s*)("(?:\\.|[^"\\])*")/m;

const match =
  installerBefore.match(objectRegex);

if (!match) {
  throw new Error(
    "CANONICAL_READER_EMBEDDED_JSON_STRING_NOT_FOUND"
  );
}

let embeddedReader;

try {
  embeddedReader =
    JSON.parse(match[2]);
} catch (error) {
  throw new Error(
    "CANONICAL_READER_EMBEDDED_JSON_PARSE_FAILED:" +
    (
      error instanceof Error
        ? error.message
        : String(error)
    )
  );
}

const patchedEmbeddedReader =
  patchReaderSource(
    embeddedReader
  );

const installerAfter =
  installerBefore.replace(
    objectRegex,
    `$1${JSON.stringify(patchedEmbeddedReader)}`
  );

write(
  installerRel,
  installerAfter
);

/*
 * Re-read and decode the installer after patching to verify the
 * persisted artifact, not only the in-memory replacement.
 */
const installerPersisted =
  read(installerRel);

const persistedMatch =
  installerPersisted.match(
    objectRegex
  );

if (!persistedMatch) {
  throw new Error(
    "CANONICAL_READER_EMBEDDED_JSON_STRING_MISSING_AFTER_PATCH"
  );
}

const persistedEmbeddedReader =
  JSON.parse(
    persistedMatch[2]
  );

const checks = {
  runtimeReaderMinimalBoundary:
    /export interface DataFreshnessSupabaseLike \{[\s\S]*?from\([\s\S]*?table:[\s\S]*?string,[\s\S]*?\): any;[\s\S]*?\}/m.test(
      readerAfter
    ),

  runtimeQueryChainRemoved:
    !readerAfter.includes(
      "type QueryChain<T>"
    ),

  runtimeGenericFromRemoved:
    !readerAfter.includes(
      ".from<FreshnessObservationRow>("
    ) &&
    !readerAfter.includes(
      ".from<QualityGateObservationRow>("
    ),

  embeddedReaderMinimalBoundary:
    /export interface DataFreshnessSupabaseLike \{[\s\S]*?from\([\s\S]*?table:[\s\S]*?string,[\s\S]*?\): any;[\s\S]*?\}/m.test(
      persistedEmbeddedReader
    ),

  embeddedQueryChainRemoved:
    !persistedEmbeddedReader.includes(
      "type QueryChain<T>"
    ),

  embeddedGenericFromRemoved:
    !persistedEmbeddedReader.includes(
      ".from<FreshnessObservationRow>("
    ) &&
    !persistedEmbeddedReader.includes(
      ".from<QualityGateObservationRow>("
    ),

  embeddedReaderMatchesRuntimeTypeShape:
    (
      persistedEmbeddedReader.includes(
        "export interface DataFreshnessSupabaseLike"
      ) &&
      readerAfter.includes(
        "export interface DataFreshnessSupabaseLike"
      )
    ),

  failClosedSemanticsPreserved:
    readerAfter.includes(
      "FRESHNESS_OBSERVATION_MISSING"
    ) &&
    readerAfter.includes(
      "QUALITY_GATE_OBSERVATION_MISSING"
    ) &&
    persistedEmbeddedReader.includes(
      "FRESHNESS_OBSERVATION_MISSING"
    ) &&
    persistedEmbeddedReader.includes(
      "QUALITY_GATE_OBSERVATION_MISSING"
    )
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_INSTALLER_TYPE_CONTRACT_FIX_V2_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_INSTALLER_TYPE_CONTRACT_FIX_V2_REVIEW",

      patchedFiles: [
        readerRel,
        installerRel
      ],

      checks,
      failed,

      diagnosis: {
        previousFailure:
          "RUNTIME_READER_FIXED_BUT_EMBEDDED_INSTALLER_JSON_STRING_NOT_PATCHED",

        fix:
          "DECODE_PATCH_AND_REENCODE_EMBEDDED_READER_JSON"
      },

      behaviorChanged:
        false,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "RERUN_STATIC_TYPESCRIPT_AND_LIVE_VERIFY"
          : "REVIEW_INSTALLER_EMBEDDED_READER"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
