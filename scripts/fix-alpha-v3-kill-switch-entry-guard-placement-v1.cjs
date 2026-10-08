const fs = require("fs");
const path = require("path");

const root = process.cwd();

const entryRel =
  "lib/trading/generate-entry-signals.ts";

const installerRel =
  "scripts/install-alpha-v3-kill-switch-application-guards-v1.cjs";

const staticRel =
  "scripts/alpha-v3-kill-switch-application-guards-v1-static-verify.cjs";

const testRel =
  "scripts/alpha-v3-kill-switch-application-guards-v1-contract-test.cjs";

function read(rel) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `FILE_NOT_FOUND ${rel}`
    );
  }

  return fs.readFileSync(abs, "utf8");
}

function write(rel, text) {
  fs.writeFileSync(
    path.resolve(root, rel),
    text,
    "utf8"
  );
}

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (
    let i = openIndex;
    i < text.length;
    i += 1
  ) {
    const ch = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (
      ch === '"' ||
      ch === "'" ||
      ch === "`"
    ) {
      quote = ch;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      continue;
    }

    if (ch === ")") {
      depth -= 1;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function placeEntryGuardCorrectly(text) {
  const guard =
    'if (input.autoOrder === true) {\n' +
    '    await assertKillSwitchAllows("PAPER_BUY_CREATE");\n' +
    '  }';

  /*
   * Remove every existing copy first, including the broken copy
   * that may have been inserted inside the default parameter object.
   */
  text = text.replace(
    /\s*if\s*\(\s*input\.autoOrder\s*===\s*true\s*\)\s*\{\s*await\s+assertKillSwitchAllows\("PAPER_BUY_CREATE"\);\s*\}/gm,
    ""
  );

  const needle =
    "export async function generateEntrySignals";

  const fnIndex =
    text.indexOf(needle);

  if (fnIndex < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_FUNCTION_NOT_FOUND"
    );
  }

  const openParen =
    text.indexOf("(", fnIndex);

  if (openParen < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_OPEN_PAREN_NOT_FOUND"
    );
  }

  const closeParen =
    findMatchingParen(
      text,
      openParen
    );

  if (closeParen < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_CLOSE_PAREN_NOT_FOUND"
    );
  }

  const bodyBrace =
    text.indexOf(
      "{",
      closeParen
    );

  if (bodyBrace < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_BODY_BRACE_NOT_FOUND"
    );
  }

  return (
    text.slice(0, bodyBrace + 1) +
    "\n  " +
    guard +
    "\n" +
    text.slice(bodyBrace + 1)
  );
}

/*
 * Repair current production source.
 */
const entryBefore =
  read(entryRel);

const entryAfter =
  placeEntryGuardCorrectly(
    entryBefore
  );

write(
  entryRel,
  entryAfter
);

/*
 * Patch the installer so rerunning it cannot make the same mistake.
 * Replace its entry-signals block with a parenthesis-aware insertion.
 */
let installer =
  read(installerRel);

const oldBlockRegex =
  /\/\*\s*\n \* Entry generation:[\s\S]*?write\(rel, text\);\s*\n\}/m;

const newBlock = `/*
 * Entry generation:
 * analysis remains allowed while latched,
 * but autoOrder=true must fail closed before
 * any create-order attempt.
 *
 * IMPORTANT:
 * The function has a default object parameter, so the first "{"
 * after the function name is NOT the function body. Locate the
 * matching ")" of the full parameter list first.
 */
{
  const rel =
    "lib/trading/generate-entry-signals.ts";

  let text =
    read(rel);

  text =
    ensureImport(
      text,
      'import { assertKillSwitchAllows } from "@/lib/trading/kill-switch-guard";'
    );

  text = text.replace(
    /\\\\s*if\\\\s*\\\\(\\\\s*input\\\\.autoOrder\\\\s*===\\\\s*true\\\\s*\\\\)\\\\s*\\\\{\\\\s*await\\\\s+assertKillSwitchAllows\\\\("PAPER_BUY_CREATE"\\\\);\\\\s*\\\\}/gm,
    ""
  );

  const fnNeedle =
    "export async function generateEntrySignals";

  const fnIndex =
    text.indexOf(fnNeedle);

  if (fnIndex < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_FUNCTION_NOT_FOUND"
    );
  }

  const openParen =
    text.indexOf("(", fnIndex);

  let depth = 0;
  let closeParen = -1;

  for (
    let i = openParen;
    i < text.length;
    i += 1
  ) {
    if (text[i] === "(") {
      depth += 1;
    } else if (text[i] === ")") {
      depth -= 1;

      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }

  if (closeParen < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_CLOSE_PAREN_NOT_FOUND"
    );
  }

  const bodyBrace =
    text.indexOf(
      "{",
      closeParen
    );

  if (bodyBrace < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_BODY_BRACE_NOT_FOUND"
    );
  }

  const statement =
    'if (input.autoOrder === true) {\\\\n' +
    '    await assertKillSwitchAllows("PAPER_BUY_CREATE");\\\\n' +
    '  }';

  text =
    text.slice(0, bodyBrace + 1) +
    "\\\\n  " +
    statement +
    "\\\\n" +
    text.slice(bodyBrace + 1);

  write(rel, text);
}`;

if (!oldBlockRegex.test(installer)) {
  throw new Error(
    "INSTALLER_ENTRY_BLOCK_NOT_FOUND"
  );
}

installer =
  installer.replace(
    oldBlockRegex,
    newBlock
  );

write(
  installerRel,
  installer
);

/*
 * Strengthen static verifier:
 * reject the exact broken placement inside `= {`.
 */
let staticText =
  read(staticRel);

if (
  !staticText.includes(
    "entryGuardNotInsideDefaultParameter"
  )
) {
  staticText =
    staticText.replace(
      "const checks = {",
      `const checks = {
  entryGuardNotInsideDefaultParameter:
    !/input:\\s*GenerateEntrySignalsInput\\s*=\\s*\\{\\s*if\\s*\\(\\s*input\\.autoOrder/m.test(
      text.entrySignals
    ),`
    );
}

write(
  staticRel,
  staticText
);

/*
 * Strengthen contract test with placement check.
 */
let testText =
  read(testRel);

if (
  !testText.includes(
    "ENTRY_GUARD_OUTSIDE_DEFAULT_PARAMETER_OBJECT"
  )
) {
  const anchor =
    "const scenarios = [";

  const replacement =
    `const scenarios = [
  {
    name:
      "ENTRY_GUARD_OUTSIDE_DEFAULT_PARAMETER_OBJECT",
    passed:
      !/input:\\s*GenerateEntrySignalsInput\\s*=\\s*\\{\\s*if\\s*\\(\\s*input\\.autoOrder/m.test(
        entrySignals
      )
  },`;

  if (!testText.includes(anchor)) {
    throw new Error(
      "CONTRACT_TEST_SCENARIOS_ANCHOR_NOT_FOUND"
    );
  }

  testText =
    testText.replace(
      anchor,
      replacement
    );
}

write(
  testRel,
  testText
);

const finalEntry =
  read(entryRel);

const checks = {
  sourceChanged:
    entryAfter !== entryBefore,

  brokenPlacementAbsent:
    !/input:\s*GenerateEntrySignalsInput\s*=\s*\{\s*if\s*\(\s*input\.autoOrder/m.test(
      finalEntry
    ),

  guardPresent:
    finalEntry.includes(
      'await assertKillSwitchAllows("PAPER_BUY_CREATE");'
    ),

  guardAfterFunctionParameterList:
    /export\s+async\s+function\s+generateEntrySignals\([\s\S]*?\)\s*(?::\s*[^{]+)?\{\s*if\s*\(\s*input\.autoOrder\s*===\s*true\s*\)\s*\{\s*await\s+assertKillSwitchAllows\("PAPER_BUY_CREATE"\);/m.test(
      finalEntry
    ),

  installerPatched:
    read(installerRel).includes(
      "GENERATE_ENTRY_SIGNALS_CLOSE_PAREN_NOT_FOUND"
    ),

  staticVerifierStrengthened:
    read(staticRel).includes(
      "entryGuardNotInsideDefaultParameter"
    ),

  contractTestStrengthened:
    read(testRel).includes(
      "ENTRY_GUARD_OUTSIDE_DEFAULT_PARAMETER_OBJECT"
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
          ? "ALPHA_V3_KILL_SWITCH_ENTRY_GUARD_PLACEMENT_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_ENTRY_GUARD_PLACEMENT_FIX_V1_REVIEW",

      patchedFiles: [
        entryRel,
        installerRel,
        staticRel,
        testRel
      ],

      checks,
      failed,

      diagnosis: {
        rootCause:
          "INSTALLER_MISTOOK_DEFAULT_PARAMETER_OBJECT_BRACE_FOR_FUNCTION_BODY",

        brokenShape:
          "input: GenerateEntrySignalsInput = { if (...) ... },",

        repairedShape:
          "input: GenerateEntrySignalsInput = {}, ) { if (...) ... }"
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "RUN_STATIC_TYPECHECK_CONTRACT_TEST_THEN_RERUN_NO_ORDER_OPERATIONAL_REGRESSION"
          : "REVIEW_ENTRY_GUARD_PLACEMENT_FIX"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
