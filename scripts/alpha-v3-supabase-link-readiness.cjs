const fs = require("fs");
const path = require("path");

const root = process.cwd();

function parseEnvFile(rel) {
  const file = path.resolve(root, rel);
  const result = {};

  if (!fs.existsSync(file)) {
    return result;
  }

  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();

    if (
      !line ||
      line.startsWith("#") ||
      !line.includes("=")
    ) {
      continue;
    }

    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();

    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function projectRefFromUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const host = url.hostname;

    const match =
      host.match(
        /^([a-z0-9]+)\.supabase\.co$/i
      );

    return match
      ? match[1]
      : null;
  } catch {
    return null;
  }
}

const env = {
  ...parseEnvFile(".env"),
  ...parseEnvFile(".env.local"),
};

const urlVariableNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
].filter(
  (name) =>
    Boolean(env[name])
);

let projectRef = null;
let sourceVariable = null;

for (const name of urlVariableNames) {
  const ref =
    projectRefFromUrl(env[name]);

  if (ref) {
    projectRef = ref;
    sourceVariable = name;
    break;
  }
}

const accessTokenPresent =
  Boolean(
    env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_ACCESS_TOKEN
  );

const serviceRolePresent =
  Boolean(
    env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

const anonKeyPresent =
  Boolean(
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  );

const packageJsonPath =
  path.resolve(root, "package.json");

let packageJson = null;

if (fs.existsSync(packageJsonPath)) {
  packageJson =
    JSON.parse(
      fs.readFileSync(
        packageJsonPath,
        "utf8"
      )
    );
}

const hasSupabaseCliDependency =
  Boolean(
    packageJson?.devDependencies?.supabase ||
    packageJson?.dependencies?.supabase
  );

const report = {
  status:
    "ALPHA_V3_SUPABASE_LINK_READINESS_COMPLETE",

  projectRefFound:
    Boolean(projectRef),

  projectRef,

  projectRefSource:
    sourceVariable,

  urlVariableNames,

  accessTokenPresent,

  serviceRolePresent,

  anonKeyPresent,

  hasSupabaseCliDependency,

  configExists:
    fs.existsSync(
      path.resolve(
        root,
        "supabase/config.toml"
      )
    ),

  secretsPrinted:
    false,

  decision: {
    readyForNonInteractiveLink:
      Boolean(projectRef) &&
      accessTokenPresent,

    readyForInteractiveLink:
      Boolean(projectRef),

    preferredNext:
      Boolean(projectRef) &&
      accessTokenPresent
        ? "INSTALL_CLI_AND_LINK_NONINTERACTIVELY"
        : Boolean(projectRef)
          ? "INSTALL_CLI_THEN_LOGIN_AND_LINK"
          : "OBTAIN_PROJECT_REF_FROM_SUPABASE_DASHBOARD",

    nextGate:
      Boolean(projectRef)
        ? "ESTABLISH_SUPABASE_CLI_LINK"
        : "PROJECT_REF_REQUIRED",
  },

  outputFile:
    "logs/alpha-v3-supabase-link-readiness.json",
};

fs.mkdirSync(
  path.dirname(
    path.resolve(root, report.outputFile)
  ),
  { recursive: true }
);

fs.writeFileSync(
  path.resolve(root, report.outputFile),
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      projectRefFound:
        report.projectRefFound,

      projectRef:
        report.projectRef,

      projectRefSource:
        report.projectRefSource,

      accessTokenPresent:
        report.accessTokenPresent,

      serviceRolePresent:
        report.serviceRolePresent,

      hasSupabaseCliDependency:
        report.hasSupabaseCliDependency,

      configExists:
        report.configExists,

      readyForNonInteractiveLink:
        report.decision.readyForNonInteractiveLink,

      readyForInteractiveLink:
        report.decision.readyForInteractiveLink,

      preferredNext:
        report.decision.preferredNext,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
