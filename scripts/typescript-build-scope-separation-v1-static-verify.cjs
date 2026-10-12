const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

function readJson(file) {
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
      /\r?\n/
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
                "\\",
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
