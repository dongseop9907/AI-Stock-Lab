const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TSCONFIG =
  path.join(
    ROOT,
    "tsconfig.json"
  );

const SCRIPT_TSCONFIG =
  path.join(
    ROOT,
    "tsconfig.scripts.json"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "typescript-build-scope-separation-v1-static-verify.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TYPESCRIPT_BUILD_SCOPE_SEPARATION_V1_FAILED",

        reason,
        ...extra
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

function readJson(
  file
) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    ).replace(
      /^\uFEFF/,
      ""
    )
  );
}

if (
  !fs.existsSync(
    TSCONFIG
  )
) {
  fail(
    "TSCONFIG_NOT_FOUND"
  );

  return;
}

if (
  !fs.existsSync(
    PACKAGE
  )
) {
  fail(
    "PACKAGE_JSON_NOT_FOUND"
  );

  return;
}

const backupDir =
  path.join(
    ROOT,
    "scripts",
    "backups"
  );

fs.mkdirSync(
  backupDir,
  {
    recursive:
      true
  }
);

const tsconfigBackup =
  path.join(
    backupDir,
    "tsconfig.before-typescript-build-scope-separation-v1.json"
  );

const packageBackup =
  path.join(
    backupDir,
    "package.before-typescript-build-scope-separation-v1.json"
  );

if (
  !fs.existsSync(
    tsconfigBackup
  )
) {
  fs.copyFileSync(
    TSCONFIG,
    tsconfigBackup
  );
}

if (
  !fs.existsSync(
    packageBackup
  )
) {
  fs.copyFileSync(
    PACKAGE,
    packageBackup
  );
}

const tsconfig =
  readJson(
    TSCONFIG
  );

if (
  !Array.isArray(
    tsconfig.exclude
  )
) {
  tsconfig.exclude = [];
}

for (
  const item of [
    "node_modules",
    "scripts/**"
  ]
) {
  if (
    !tsconfig.exclude.includes(
      item
    )
  ) {
    tsconfig.exclude.push(
      item
    );
  }
}

fs.writeFileSync(
  TSCONFIG,
  JSON.stringify(
    tsconfig,
    null,
    2
  ) + "\n",
  "utf8"
);

const scriptTsconfig = {
  extends:
    "./tsconfig.json",

  compilerOptions: {
    noEmit:
      true,

    incremental:
      false
  },

  include: [
    "scripts/**/*.ts"
  ],

  exclude: [
    "node_modules",
    "scripts/backups/**"
  ]
};

fs.writeFileSync(
  SCRIPT_TSCONFIG,
  JSON.stringify(
    scriptTsconfig,
    null,
    2
  ) + "\n",
  "utf8"
);

const pkg =
  readJson(
    PACKAGE
  );

if (
  !pkg.scripts ||
  typeof pkg.scripts !==
    "object"
) {
  pkg.scripts = {};
}

pkg.scripts[
  "typecheck:app"
] =
  "tsc --noEmit -p tsconfig.json";

pkg.scripts[
  "typecheck:scripts"
] =
  "tsc --noEmit -p tsconfig.scripts.json";

pkg.scripts[
  "typecheck:all"
] =
  "npm run typecheck:app && npm run typecheck:scripts";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(
    pkg,
    null,
    2
  ) + "\n",
  "utf8"
);

const staticSource = `const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    ).replace(
      /^\\uFEFF/,
      ""
    )
  );
}

function walk(
  dir,
  out = []
) {
  if (
    !fs.existsSync(
      dir
    )
  ) {
    return out;
  }

  for (
    const entry of
    fs.readdirSync(
      dir,
      {
        withFileTypes:
          true
      }
    )
  ) {
    if (
      entry.name ===
        "node_modules" ||
      entry.name ===
        ".next"
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name
      );

    if (
      entry.isDirectory()
    ) {
      walk(
        full,
        out
      );
    }
    else if (
      entry.name.endsWith(
        ".ts"
      ) ||
      entry.name.endsWith(
        ".tsx"
      )
    ) {
      out.push(
        full
      );
    }
  }

  return out;
}

const tsconfigPath =
  path.join(
    ROOT,
    "tsconfig.json"
  );

const scriptsConfigPath =
  path.join(
    ROOT,
    "tsconfig.scripts.json"
  );

const packagePath =
  path.join(
    ROOT,
    "package.json"
  );

const checks = {
  tsconfigExists:
    fs.existsSync(
      tsconfigPath
    ),

  scriptTsconfigExists:
    fs.existsSync(
      scriptsConfigPath
    ),

  packageExists:
    fs.existsSync(
      packagePath
    )
};

if (
  checks.tsconfigExists
) {
  const config =
    readJson(
      tsconfigPath
    );

  checks.mainBuildExcludesScripts =
    Array.isArray(
      config.exclude
    ) &&
    config.exclude.includes(
      "scripts/**"
    );
}

if (
  checks.scriptTsconfigExists
) {
  const config =
    readJson(
      scriptsConfigPath
    );

  checks.scriptConfigIncludesScripts =
    Array.isArray(
      config.include
    ) &&
    config.include.includes(
      "scripts/**/*.ts"
    );

  checks.scriptConfigExcludesBackups =
    Array.isArray(
      config.exclude
    ) &&
    config.exclude.includes(
      "scripts/backups/**"
    );
}

if (
  checks.packageExists
) {
  const pkg =
    readJson(
      packagePath
    );

  checks.appTypecheckCommandPresent =
    pkg.scripts &&
    pkg.scripts[
      "typecheck:app"
    ] ===
      "tsc --noEmit -p tsconfig.json";

  checks.scriptTypecheckCommandPresent =
    pkg.scripts &&
    pkg.scripts[
      "typecheck:scripts"
    ] ===
      "tsc --noEmit -p tsconfig.scripts.json";
}

const runtimeFiles = [
  ...walk(
    path.join(
      ROOT,
      "app"
    )
  ),
  ...walk(
    path.join(
      ROOT,
      "lib"
    )
  )
];

const scriptImports = [];

for (
  const file of
  runtimeFiles
) {
  const source =
    fs.readFileSync(
      file,
      "utf8"
    );

  const lines =
    source.split(
      /\\r?\\n/
    );

  lines.forEach(
    (
      line,
      index
    ) => {
      if (
        (
          line.includes(
            "from"
          ) ||
          line.includes(
            "require("
          ) ||
          line.includes(
            "import("
          )
        ) &&
        (
          line.includes(
            "@/scripts/"
          ) ||
          line.includes(
            "../scripts/"
          ) ||
          line.includes(
            "../../scripts/"
          ) ||
          line.includes(
            "../../../scripts/"
          )
        )
      ) {
        scriptImports.push({
          file:
            path
              .relative(
                ROOT,
                file
              )
              .replaceAll(
                "\\\\",
                "/"
              ),

          line:
            index +
            1,

          text:
            line.trim()
        });
      }
    }
  );
}

checks.noRuntimeImportsFromScripts =
  scriptImports.length ===
  0;

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_TYPESCRIPT_BUILD_SCOPE_SEPARATION_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_TYPESCRIPT_BUILD_SCOPE_SEPARATION_V1_STATIC_FAILED",

      checks,

      runtimeScriptImports:
        scriptImports,

      policy: {
        nextBuildScope:
          "app/lib/runtime graph",

        scriptsScope:
          "dedicated strict tsconfig.scripts.json",

        scriptErrorsHidden:
          false,

        scriptErrorsTrackedSeparately:
          true
      },

      safety: {
        runtimeSourceChanged:
          false,

        tradingLogicChanged:
          false,

        scriptExecution:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        promotionExecuted:
          false,

        realTradingEnabled:
          false
      },

      failed,

      nextGate:
        failed.length === 0
          ? "RUN_APP_TYPECHECK_BUILD_AND_SEPARATE_SCRIPT_TYPECHECK"
          : "REPAIR_BUILD_SCOPE_SEPARATION"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

const checks = {
  mainTsconfigExcludesScripts:
    tsconfig.exclude.includes(
      "scripts/**"
    ),

  dedicatedScriptTsconfigCreated:
    fs.existsSync(
      SCRIPT_TSCONFIG
    ),

  appTypecheckScriptCreated:
    pkg.scripts[
      "typecheck:app"
    ] ===
      "tsc --noEmit -p tsconfig.json",

  scriptsTypecheckScriptCreated:
    pkg.scripts[
      "typecheck:scripts"
    ] ===
      "tsc --noEmit -p tsconfig.scripts.json",

  runtimeLogicChanged:
    false
};

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_TYPESCRIPT_BUILD_SCOPE_SEPARATION_V1_REPAIRED",

      changedFiles: [
        "tsconfig.json",
        "package.json"
      ],

      generatedFiles: [
        "tsconfig.scripts.json",
        "scripts/typescript-build-scope-separation-v1-static-verify.cjs"
      ],

      backups: [
        "scripts/backups/tsconfig.before-typescript-build-scope-separation-v1.json",
        "scripts/backups/package.before-typescript-build-scope-separation-v1.json"
      ],

      rationale: {
        currentFullSweep:
          "all reported TypeScript errors are under standalone scripts/",

        appLibErrors:
          "none reported in current full sweep",

        nextBuild:
          "should validate production app/runtime code instead of every standalone research/test/maintenance script",

        scripts:
          "remain under strict dedicated typecheck and are NOT ignored"
      },

      checks,

      safety: {
        runtimeSourceChanged:
          false,

        tradingLogicChanged:
          false,

        scriptExecution:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        promotionExecuted:
          false,

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_APP_TYPECHECK_DASHBOARD_BUILD_AND_SEPARATE_SCRIPT_TYPECHECK"
    },
    null,
    2
  )
);

process.exitCode = 0;
