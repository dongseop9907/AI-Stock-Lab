const fs = require("fs");
const path = require("path");

const root = process.cwd();

const readerRel =
  "lib/trading/data-freshness-canonical-reader.ts";

const readerInstallerRel =
  "scripts/install-alpha-v3-data-freshness-canonical-reader-v1.cjs";

function read(rel) {
  const file =
    path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    throw new Error(
      `FILE_NOT_FOUND ${rel}`
    );
  }

  return fs.readFileSync(
    file,
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

function patchReader(source) {
  let text = source;

  /*
   * The old interface incorrectly modeled .from() as already having
   * .order/.limit/.maybeSingle. In Supabase those methods are exposed
   * after .select().
   *
   * Keep only the structural boundary this module actually needs:
   * a caller with .from(table). Runtime query shape is still validated
   * by the canonical reader's fail-closed behavior.
   */
  text =
    text.replace(
      /type QueryChain<T> = \{[\s\S]*?\n\};\n\nexport interface DataFreshnessSupabaseLike \{[\s\S]*?\n\}/m,
      `export interface DataFreshnessSupabaseLike {
  from(
    table:
      string,
  ): any;
}`
    );

  /*
   * Once the boundary is structural/minimal, do not pass a type
   * argument to .from(); Supabase's own builder carries its SDK types.
   */
  text =
    text.replaceAll(
      `.from<FreshnessObservationRow>(`,
      `.from(`
    );

  text =
    text.replaceAll(
      `.from<QualityGateObservationRow>(`,
      `.from(`
    );

  return text;
}

const readerBefore =
  read(readerRel);

const readerAfter =
  patchReader(
    readerBefore
  );

write(
  readerRel,
  readerAfter
);

/*
 * Patch the original canonical-reader installer too, so rerunning it
 * does not restore the bad structural type.
 */
const installerBefore =
  read(readerInstallerRel);

let installerAfter =
  installerBefore;

installerAfter =
  installerAfter.replace(
    /type QueryChain<T> = \{[\s\S]*?export interface DataFreshnessSupabaseLike \{[\s\S]*?\n\}\n\nconst FRESHNESS_SELECT/m,
    `export interface DataFreshnessSupabaseLike {
  from(
    table:
      string,
  ): any;
}

const FRESHNESS_SELECT`
  );

installerAfter =
  installerAfter.replaceAll(
    `.from<FreshnessObservationRow>(`,
    `.from(`
  );

installerAfter =
  installerAfter.replaceAll(
    `.from<QualityGateObservationRow>(`,
    `.from(`
  );

write(
  readerInstallerRel,
  installerAfter
);

const checks = {
  readerChanged:
    readerAfter !== readerBefore,

  minimalStructuralBoundary:
    /export interface DataFreshnessSupabaseLike \{[\s\S]*?from\([\s\S]*?table:[\s\S]*?string,[\s\S]*?\): any;[\s\S]*?\}/m.test(
      readerAfter
    ),

  invalidQueryChainRemoved:
    !readerAfter.includes(
      "type QueryChain<T>"
    ),

  freshnessGenericFromRemoved:
    !readerAfter.includes(
      ".from<FreshnessObservationRow>"
    ),

  qualityGenericFromRemoved:
    !readerAfter.includes(
      ".from<QualityGateObservationRow>"
    ),

  failClosedFreshnessStillPresent:
    readerAfter.includes(
      "FRESHNESS_OBSERVATION_MISSING"
    ),

  failClosedQualityStillPresent:
    readerAfter.includes(
      "QUALITY_GATE_OBSERVATION_MISSING"
    ),

  installerPatched:
    installerAfter.includes(
      "export interface DataFreshnessSupabaseLike"
    ) &&
    !installerAfter.includes(
      "type QueryChain<T>"
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
          ? "ALPHA_V3_DATA_FRESHNESS_SUPABASE_TYPE_CONTRACT_FIX_V1_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_SUPABASE_TYPE_CONTRACT_FIX_V1_REVIEW",

      patchedFiles: [
        readerRel,
        readerInstallerRel
      ],

      checks,
      failed,

      diagnosis: {
        rootCause:
          "CANONICAL_READER_MODELED_FROM_RETURN_AS_POST_SELECT_QUERY_CHAIN",

        actualSdkShape:
          "from() -> PostgrestQueryBuilder -> select() -> filter/transform builder",

        fix:
          "MINIMAL_STRUCTURAL_FROM_BOUNDARY"
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
          ? "RERUN_STATIC_TARGETED_TYPESCRIPT_AND_LIVE_READER"
          : "REVIEW_SUPABASE_TYPE_CONTRACT_FIX"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
