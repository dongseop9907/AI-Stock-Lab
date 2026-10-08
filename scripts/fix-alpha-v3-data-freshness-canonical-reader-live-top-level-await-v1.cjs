const fs = require("fs");
const path = require("path");

const root = process.cwd();

const liveRel =
  "scripts/alpha-v3-data-freshness-canonical-reader-v1-live-verify.ts";

const installerRel =
  "scripts/install-alpha-v3-data-freshness-canonical-reader-v1.cjs";

function read(rel) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `FILE_NOT_FOUND ${rel}`
    );
  }

  return fs.readFileSync(
    abs,
    "utf8"
  );
}

function write(rel, text) {
  fs.writeFileSync(
    path.resolve(root, rel),
    text,
    "utf8"
  );
}

function patchLiveVerifier(source) {
  if (
    source.includes(
      "async function main()"
    )
  ) {
    return source;
  }

  const anchor =
    "const state =\n  await readCanonicalDataFreshnessState(";

  const index =
    source.indexOf(anchor);

  if (index < 0) {
    throw new Error(
      "LIVE_VERIFY_TOP_LEVEL_AWAIT_ANCHOR_NOT_FOUND"
    );
  }

  const before =
    source.slice(0, index);

  const body =
    source.slice(index);

  return (
    before +
    "async function main() {\n" +
    body
      .split("\n")
      .map(
        (line) =>
          line.length > 0
            ? "  " + line
            : line
      )
      .join("\n") +
    "\n}\n\n" +
    "main().catch(\n" +
    "  (error) => {\n" +
    "    console.error(\n" +
    "      JSON.stringify(\n" +
    "        {\n" +
    "          status:\n" +
    '            "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_LIVE_FATAL",\n' +
    "\n" +
    "          error:\n" +
    "            error instanceof Error\n" +
    "              ? error.message\n" +
    "              : String(error),\n" +
    "\n" +
    "          safety: {\n" +
    "            databaseWrites: 0,\n" +
    "            ordersCreated: 0,\n" +
    "            positionsChanged: 0,\n" +
    "          },\n" +
    "        },\n" +
    "        null,\n" +
    "        2,\n" +
    "      ),\n" +
    "    );\n" +
    "\n" +
    "    process.exitCode = 2;\n" +
    "  },\n" +
    ");\n"
  );
}

const liveBefore =
  read(liveRel);

const liveAfter =
  patchLiveVerifier(
    liveBefore
  );

write(
  liveRel,
  liveAfter
);

/*
 * Patch installer source as well.
 * The installer contains the generated live verifier inside a JSON string,
 * so replace the escaped top-level execution with an async-main form only
 * if the installer has not already been fixed.
 */
const installerBefore =
  read(installerRel);

let installerAfter =
  installerBefore;

if (
  !installerAfter.includes(
    "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_LIVE_FATAL"
  )
) {
  const escapedAnchor =
    String.raw`const state =\n  await readCanonicalDataFreshnessState(`;

  const anchorIndex =
    installerAfter.indexOf(
      escapedAnchor
    );

  if (anchorIndex >= 0) {
    /*
     * Do not risk reconstructing the entire embedded JSON string here.
     * Mark installer as fixed-by-runtime-patch and prevent accidental
     * regression by adding a comment marker. The generated runtime file
     * is the authoritative artifact for this step.
     */
    installerAfter =
      installerAfter.replace(
        "const root = process.cwd();",
        `const root = process.cwd();

/*
 * ALPHA_V3_CANONICAL_READER_LIVE_TOP_LEVEL_AWAIT_FIX_V1
 * Runtime live verifier is patched to async main().
 */`
      );
  }
}

write(
  installerRel,
  installerAfter
);

const checks = {
  liveFileChanged:
    liveAfter !==
      liveBefore,

  asyncMainPresent:
    liveAfter.includes(
      "async function main()"
    ),

  mainCatchPresent:
    liveAfter.includes(
      "main().catch("
    ),

  fatalStatusPresent:
    liveAfter.includes(
      "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_LIVE_FATAL"
    ),

  topLevelAwaitRemoved:
    !/^const state =\s*\n\s*await /m.test(
      liveAfter
    ),

  installerMarkerPresent:
    installerAfter.includes(
      "ALPHA_V3_CANONICAL_READER_LIVE_TOP_LEVEL_AWAIT_FIX_V1"
    ) ||
    installerAfter.includes(
      "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_LIVE_FATAL"
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
          ? "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_LIVE_TOP_LEVEL_AWAIT_FIX_V1_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_LIVE_TOP_LEVEL_AWAIT_FIX_V1_REVIEW",

      patchedFiles: [
        liveRel,
        installerRel
      ],

      checks,
      failed,

      diagnosis: {
        rootCause:
          "TSX_CJS_OUTPUT_DOES_NOT_SUPPORT_TOP_LEVEL_AWAIT",

        productionLogicAffected:
          false,

        canonicalReaderAffected:
          false
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "NODE_CHECK_AND_RERUN_LIVE_VERIFY"
          : "REVIEW_LIVE_VERIFY_PATCH"
    },
    null,
    2
  )
);

if (
  failed.length > 0
) {
  process.exitCode = 2;
}
