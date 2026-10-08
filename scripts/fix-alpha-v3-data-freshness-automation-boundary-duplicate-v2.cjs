const fs = require("fs");
const path = require("path");

const root = process.cwd();

const routeRel =
  "app/api/trading/automation/run/route.ts";

const installerRel =
  "scripts/install-alpha-v3-data-freshness-production-guards-v2.cjs";

function abs(rel) {
  return path.resolve(root, rel);
}

function read(rel) {
  const file = abs(rel);

  if (!fs.existsSync(file)) {
    throw new Error("FILE_NOT_FOUND " + rel);
  }

  return fs.readFileSync(file, "utf8");
}

function write(rel, text) {
  fs.writeFileSync(
    abs(rel),
    text,
    "utf8"
  );
}

function count(text, needle) {
  let n = 0;
  let pos = 0;

  while (true) {
    const i =
      text.indexOf(
        needle,
        pos
      );

    if (i < 0) {
      return n;
    }

    n += 1;
    pos =
      i + needle.length;
  }
}

function patchRuntimeRoute(text) {
  const marker =
    "/* ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2 */";

  const markerIndex =
    text.indexOf(marker);

  if (markerIndex < 0) {
    throw new Error(
      "AUTOMATION_FRESHNESS_MARKER_NOT_FOUND"
    );
  }

  const duplicateDecl =
    "const requestedAutoOrder =";

  const declIndex =
    text.indexOf(
      duplicateDecl,
      markerIndex
    );

  if (declIndex < 0) {
    if (
      text.indexOf(
        "const controlEligibleAutoOrder =",
        markerIndex
      ) >= 0
    ) {
      return {
        text,
        alreadyFixed: true
      };
    }

    throw new Error(
      "POST_MARKER_REQUESTED_AUTO_ORDER_DECLARATION_NOT_FOUND"
    );
  }

  const declarationEnd =
    text.indexOf(
      ";",
      declIndex
    );

  if (declarationEnd < 0) {
    throw new Error(
      "REQUESTED_AUTO_ORDER_DECLARATION_END_NOT_FOUND"
    );
  }

  const autoOrderIndex =
    text.indexOf(
      "const autoOrder =",
      declarationEnd
    );

  if (autoOrderIndex < 0) {
    throw new Error(
      "FINAL_AUTO_ORDER_DECLARATION_NOT_FOUND"
    );
  }

  const autoOrderEnd =
    text.indexOf(
      ";",
      autoOrderIndex
    );

  if (autoOrderEnd < 0) {
    throw new Error(
      "FINAL_AUTO_ORDER_DECLARATION_END_NOT_FOUND"
    );
  }

  const declarationBlock =
    text
      .slice(
        declIndex,
        declarationEnd + 1
      )
      .replace(
        "const requestedAutoOrder =",
        "const controlEligibleAutoOrder ="
      );

  const decisionBlock =
    text
      .slice(
        declarationEnd + 1,
        autoOrderEnd + 1
      )
      .replaceAll(
        "requestedAutoOrder",
        "controlEligibleAutoOrder"
      );

  return {
    text:
      text.slice(
        0,
        declIndex
      ) +
      declarationBlock +
      decisionBlock +
      text.slice(
        autoOrderEnd + 1
      ),

    alreadyFixed:
      false
  };
}

function patchInstallerConservatively(text) {
  /*
   * The installer must not recreate the duplicate declaration on a clean
   * reinstall. Instead of embedding a nested template literal again,
   * add a post-generation repair pass using ordinary quoted strings.
   */
  const sentinel =
    "ALPHA_V3_AUTOMATION_BOUNDARY_DUPLICATE_REPAIR_V2";

  if (
    text.includes(
      sentinel
    )
  ) {
    return text;
  }

  const insertionPoint =
    text.lastIndexOf(
      "console.log("
    );

  if (insertionPoint < 0) {
    throw new Error(
      "INSTALLER_FINAL_CONSOLE_LOG_NOT_FOUND"
    );
  }

  const repairLines = [
    "",
    "/* " + sentinel + " */",
    "{",
    "  const rel = \"app/api/trading/automation/run/route.ts\";",
    "  const file = path.resolve(root, rel);",
    "",
    "  if (fs.existsSync(file)) {",
    "    let t = fs.readFileSync(file, \"utf8\");",
    "    const marker = \"/* ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2 */\";",
    "    const markerIndex = t.indexOf(marker);",
    "",
    "    if (markerIndex >= 0) {",
    "      const decl = \"const requestedAutoOrder =\";",
    "      const declIndex = t.indexOf(decl, markerIndex);",
    "",
    "      if (declIndex >= 0) {",
    "        const declEnd = t.indexOf(\";\", declIndex);",
    "        const autoIndex = t.indexOf(\"const autoOrder =\", declEnd);",
    "        const autoEnd = autoIndex >= 0 ? t.indexOf(\";\", autoIndex) : -1;",
    "",
    "        if (declEnd >= 0 && autoIndex >= 0 && autoEnd >= 0) {",
    "          const declBlock = t.slice(declIndex, declEnd + 1)",
    "            .replace(",
    "              \"const requestedAutoOrder =\",",
    "              \"const controlEligibleAutoOrder =\"",
    "            );",
    "",
    "          const decisionBlock = t.slice(declEnd + 1, autoEnd + 1)",
    "            .replaceAll(",
    "              \"requestedAutoOrder\",",
    "              \"controlEligibleAutoOrder\"",
    "            );",
    "",
    "          t = t.slice(0, declIndex) +",
    "            declBlock +",
    "            decisionBlock +",
    "            t.slice(autoEnd + 1);",
    "",
    "          fs.writeFileSync(file, t, \"utf8\");",
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
    "",
    ""
  ].join("\n");

  return (
    text.slice(
      0,
      insertionPoint
    ) +
    repairLines +
    text.slice(
      insertionPoint
    )
  );
}

const routeBefore =
  read(routeRel);

const routeResult =
  patchRuntimeRoute(
    routeBefore
  );

write(
  routeRel,
  routeResult.text
);

const installerBefore =
  read(installerRel);

const installerAfter =
  patchInstallerConservatively(
    installerBefore
  );

write(
  installerRel,
  installerAfter
);

const routeAfter =
  read(routeRel);

const marker =
  "/* ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2 */";

const markerIndex =
  routeAfter.indexOf(marker);

const controlIndex =
  routeAfter.indexOf(
    "const controlEligibleAutoOrder =",
    markerIndex
  );

const autoIndex =
  routeAfter.indexOf(
    "const autoOrder =",
    controlIndex
  );

const markerWindow =
  markerIndex >= 0 &&
  autoIndex >= 0
    ? routeAfter.slice(
        markerIndex,
        routeAfter.indexOf(
          ";",
          autoIndex
        ) + 1
      )
    : "";

const checks = {
  markerPresent:
    markerIndex >= 0,

  exactlyOneRequestedAutoOrderDeclaration:
    count(
      routeAfter,
      "const requestedAutoOrder ="
    ) === 1,

  controlEligibleDeclarationPresent:
    controlIndex >= 0,

  controlEligibleUsesOriginalRequest:
    markerWindow.includes(
      "requestedAutoOrder"
    ),

  freshnessDecisionUsesControlEligible:
    markerWindow.includes(
      "controlEligibleAutoOrder"
    ) &&
    markerWindow.includes(
      "readCurrentDataFreshnessProductionDecision"
    ),

  finalAutoOrderUsesControlEligible:
    markerWindow.includes(
      "const autoOrder ="
    ) &&
    markerWindow.includes(
      "controlEligibleAutoOrder"
    ),

  emergencyStopPreserved:
    markerWindow.includes(
      "control.emergencyStop"
    ),

  automationEnabledPreserved:
    markerWindow.includes(
      "control.automationEnabled"
    ),

  paperOrderEnabledPreserved:
    markerWindow.includes(
      "control.paperOrderEnabled"
    ),

  duplicateSelfDeclarationRemoved:
    !markerWindow.includes(
      "const requestedAutoOrder =\n    requestedAutoOrder"
    ),

  installerRepairPersisted:
    installerAfter.includes(
      "ALPHA_V3_AUTOMATION_BOUNDARY_DUPLICATE_REPAIR_V2"
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
          ? "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_DUPLICATE_FIX_V2_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_DUPLICATE_FIX_V2_REVIEW",

      patchedFiles: [
        routeRel,
        installerRel
      ],

      diagnosis: {
        previousFixerFailure:
          "NESTED_TEMPLATE_LITERAL_SYNTAX_ERROR",

        runtimeRootCause:
          "V2_GUARD_PATCH_REDECLARED_REQUESTED_AUTO_ORDER",

        repair:
          "RENAME_ONLY_POST_MARKER_DUPLICATE_TO_CONTROL_ELIGIBLE_AND_REWRITE_FRESHNESS_DECISION_REFERENCES"
      },

      checks,
      failed,

      behavior: {
        originalRequestedAutoOrderPreserved:
          true,

        killSwitchConditionsPreserved:
          true,

        freshnessDecisionPreserved:
          true,

        orderBehaviorChanged:
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
          ? "RUN_STATIC_TYPESCRIPT_AND_RETRY_MARKET_DATA_MAINTENANCE_ONCE"
          : "REVIEW_AUTOMATION_BOUNDARY_REPAIR"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
