const fs = require("fs");
const path = require("path");

const root = process.cwd();
const migrationsDir =
  path.resolve(
    root,
    "supabase/migrations"
  );

const outputFile =
  path.resolve(
    root,
    "logs/alpha-v3-model-function-drift-probe.json"
  );

const targets = [
  "bind_model_to_filled_position",
  "attach_model_to_trade_history",
];

function lineNumberAt(text, index) {
  return (
    text
      .slice(0, index)
      .split(/\r?\n/)
      .length
  );
}

function context(text, index, radius = 18) {
  const lines =
    text.replace(/\r\n/g, "\n")
      .split("\n");

  const line =
    lineNumberAt(
      text,
      index
    );

  const start =
    Math.max(
      1,
      line - radius
    );

  const end =
    Math.min(
      lines.length,
      line + radius
    );

  return {
    startLine:
      start,

    endLine:
      end,

    text:
      lines
        .slice(
          start - 1,
          end
        )
        .map(
          (value, offset) =>
            `${start + offset}: ${value}`
        )
        .join("\n"),
  };
}

function extractCreateDefinition(
  text,
  functionName,
) {
  const escaped =
    functionName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const regex =
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:(?:public|[a-zA-Z_][\\w$]*)\\s*\\.\\s*)?"?${escaped}"?\\s*\\(`,
      "ig"
    );

  const results = [];
  let match;

  while (
    (match = regex.exec(text))
  ) {
    const start =
      match.index;

    const nextCreate =
      text
        .slice(start + 10)
        .search(
          /\n(?:create|alter|drop)\s+/i
        );

    const rawEnd =
      nextCreate >= 0
        ? start + 10 + nextCreate
        : Math.min(
            text.length,
            start + 12000
          );

    const block =
      text.slice(
        start,
        rawEnd
      );

    const returnsMatch =
      block.match(
        /\breturns\s+([^\s;]+(?:\s+[^\s;]+)?)/i
      );

    const languageMatch =
      block.match(
        /\blanguage\s+([a-zA-Z_][\w$]*)/i
      );

    results.push({
      line:
        lineNumberAt(
          text,
          start
        ),

      returns:
        returnsMatch
          ? returnsMatch[1]
              .replace(/\s+/g, " ")
              .trim()
          : null,

      returnsTrigger:
        /\breturns\s+trigger\b/i.test(
          block
        ),

      returnsEventTrigger:
        /\breturns\s+event_trigger\b/i.test(
          block
        ),

      language:
        languageMatch
          ? languageMatch[1]
          : null,

      context:
        context(
          text,
          start,
          25
        ),
    });
  }

  return results;
}

function findOperations(
  text,
  functionName,
) {
  const escaped =
    functionName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const patterns = [
    {
      type:
        "DROP_FUNCTION",

      regex:
        new RegExp(
          `drop\\s+function(?:\\s+if\\s+exists)?\\s+(?:(?:public|[a-zA-Z_][\\w$]*)\\s*\\.\\s*)?"?${escaped}"?`,
          "ig"
        ),
    },

    {
      type:
        "TRIGGER_EXECUTE",

      regex:
        new RegExp(
          `execute\\s+(?:function|procedure)\\s+(?:(?:public|[a-zA-Z_][\\w$]*)\\s*\\.\\s*)?"?${escaped}"?`,
          "ig"
        ),
    },

    {
      type:
        "FUNCTION_REFERENCE",

      regex:
        new RegExp(
          `\\b${escaped}\\b`,
          "ig"
        ),
    },
  ];

  const operations = [];

  for (
    const {
      type,
      regex,
    }
    of patterns
  ) {
    let match;

    while (
      (match = regex.exec(text))
    ) {
      operations.push({
        type,

        line:
          lineNumberAt(
            text,
            match.index
          ),

        context:
          context(
            text,
            match.index,
            type ===
              "FUNCTION_REFERENCE"
              ? 5
              : 12
          ),
      });
    }
  }

  return operations;
}

const files =
  fs.readdirSync(
    migrationsDir
  )
    .filter(
      (name) =>
        name.endsWith(".sql")
    )
    .sort();

const targetsReport = {};

for (const target of targets) {
  const occurrences = [];

  for (const file of files) {
    const full =
      path.join(
        migrationsDir,
        file
      );

    const text =
      fs.readFileSync(
        full,
        "utf8"
      );

    if (
      !text
        .toLowerCase()
        .includes(
          target.toLowerCase()
        )
    ) {
      continue;
    }

    occurrences.push({
      file,

      definitions:
        extractCreateDefinition(
          text,
          target
        ),

      operations:
        findOperations(
          text,
          target
        ),
    });
  }

  const definitions =
    occurrences.flatMap(
      (row) =>
        row.definitions.map(
          (definition) => ({
            file:
              row.file,
            ...definition,
          })
        )
    );

  const drops =
    occurrences.flatMap(
      (row) =>
        row.operations
          .filter(
            (operation) =>
              operation.type ===
              "DROP_FUNCTION"
          )
          .map(
            (operation) => ({
              file:
                row.file,
              ...operation,
            })
          )
    );

  const triggerExecutions =
    occurrences.flatMap(
      (row) =>
        row.operations
          .filter(
            (operation) =>
              operation.type ===
              "TRIGGER_EXECUTE"
          )
          .map(
            (operation) => ({
              file:
                row.file,
              ...operation,
            })
          )
    );

  const latestDefinition =
    definitions.length > 0
      ? definitions[
          definitions.length - 1
        ]
      : null;

  const latestDrop =
    drops.length > 0
      ? drops[
          drops.length - 1
        ]
      : null;

  let classification =
    "UNKNOWN";

  if (
    latestDefinition?.returnsTrigger ||
    latestDefinition?.returnsEventTrigger
  ) {
    classification =
      "TRIGGER_FUNCTION_NOT_EXPECTED_IN_RPC_TYPES";
  } else if (
    definitions.length > 0 &&
    triggerExecutions.length > 0
  ) {
    classification =
      "TRIGGER_CONNECTED_FUNCTION";
  } else if (
    definitions.length > 0
  ) {
    classification =
      "NORMAL_FUNCTION_EXPECTED_IN_SCHEMA_FUNCTIONS";
  }

  if (
    latestDrop &&
    latestDefinition
  ) {
    const dropFileIndex =
      files.indexOf(
        latestDrop.file
      );

    const defFileIndex =
      files.indexOf(
        latestDefinition.file
      );

    if (
      dropFileIndex >
      defFileIndex
    ) {
      classification =
        "DROPPED_BY_LATER_MIGRATION";
    }
  }

  targetsReport[target] = {
    classification,

    definitionCount:
      definitions.length,

    dropCount:
      drops.length,

    triggerExecutionCount:
      triggerExecutions.length,

    definitions,

    drops,

    triggerExecutions,

    occurrenceFiles:
      occurrences.map(
        (row) =>
          row.file
      ),
  };
}

const classifications =
  Object.values(
    targetsReport
  ).map(
    (row) =>
      row.classification
  );

const allExplained =
  classifications.every(
    (value) =>
      value ===
        "TRIGGER_FUNCTION_NOT_EXPECTED_IN_RPC_TYPES" ||
      value ===
        "TRIGGER_CONNECTED_FUNCTION" ||
      value ===
        "DROPPED_BY_LATER_MIGRATION"
  );

const report = {
  status:
    "ALPHA_V3_MODEL_FUNCTION_DRIFT_PROBE_COMPLETE",

  targets:
    targetsReport,

  decision: {
    genTypesAbsenceExplained:
      allExplained,

    migration009CanRemainBaselineCandidate:
      allExplained,

    nextGate:
      allExplained
        ? "AUDIT_NO_SCHEMA_SIGNATURE_MIGRATIONS_AND_BUILD_HISTORY_REPAIR_PLAN"
        : "VERIFY_MISSING_NORMAL_FUNCTIONS_ON_REMOTE_DB",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    migrationHistoryChanged: false,
    migrationsApplied: 0,
  },

  outputFile:
    "logs/alpha-v3-model-function-drift-probe.json",
};

fs.mkdirSync(
  path.dirname(
    outputFile
  ),
  {
    recursive: true,
  }
);

fs.writeFileSync(
  outputFile,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      functions:
        Object.fromEntries(
          Object.entries(
            report.targets
          ).map(
            ([name, row]) => [
              name,
              {
                classification:
                  row.classification,

                definitionCount:
                  row.definitionCount,

                dropCount:
                  row.dropCount,

                triggerExecutionCount:
                  row.triggerExecutionCount,

                occurrenceFiles:
                  row.occurrenceFiles,
              },
            ]
          )
        ),

      genTypesAbsenceExplained:
        report.decision.genTypesAbsenceExplained,

      migration009CanRemainBaselineCandidate:
        report.decision.migration009CanRemainBaselineCandidate,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
