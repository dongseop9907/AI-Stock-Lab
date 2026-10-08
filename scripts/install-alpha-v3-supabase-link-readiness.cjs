const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-supabase-link-readiness.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nfunction parseEnvFile(rel) {\n  const file = path.resolve(root, rel);\n  const result = {};\n\n  if (!fs.existsSync(file)) {\n    return result;\n  }\n\n  const lines = fs\n    .readFileSync(file, \"utf8\")\n    .split(/\\r?\\n/);\n\n  for (const raw of lines) {\n    const line = raw.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\") ||\n      !line.includes(\"=\")\n    ) {\n      continue;\n    }\n\n    const index = line.indexOf(\"=\");\n    const key = line.slice(0, index).trim();\n\n    let value = line.slice(index + 1).trim();\n\n    if (\n      (value.startsWith('\"') && value.endsWith('\"')) ||\n      (value.startsWith(\"'\") && value.endsWith(\"'\"))\n    ) {\n      value = value.slice(1, -1);\n    }\n\n    result[key] = value;\n  }\n\n  return result;\n}\n\nfunction projectRefFromUrl(value) {\n  if (!value) {\n    return null;\n  }\n\n  try {\n    const url = new URL(value);\n    const host = url.hostname;\n\n    const match =\n      host.match(\n        /^([a-z0-9]+)\\.supabase\\.co$/i\n      );\n\n    return match\n      ? match[1]\n      : null;\n  } catch {\n    return null;\n  }\n}\n\nconst env = {\n  ...parseEnvFile(\".env\"),\n  ...parseEnvFile(\".env.local\"),\n};\n\nconst urlVariableNames = [\n  \"NEXT_PUBLIC_SUPABASE_URL\",\n  \"SUPABASE_URL\",\n].filter(\n  (name) =>\n    Boolean(env[name])\n);\n\nlet projectRef = null;\nlet sourceVariable = null;\n\nfor (const name of urlVariableNames) {\n  const ref =\n    projectRefFromUrl(env[name]);\n\n  if (ref) {\n    projectRef = ref;\n    sourceVariable = name;\n    break;\n  }\n}\n\nconst accessTokenPresent =\n  Boolean(\n    env.SUPABASE_ACCESS_TOKEN ||\n    process.env.SUPABASE_ACCESS_TOKEN\n  );\n\nconst serviceRolePresent =\n  Boolean(\n    env.SUPABASE_SERVICE_ROLE_KEY ||\n    process.env.SUPABASE_SERVICE_ROLE_KEY\n  );\n\nconst anonKeyPresent =\n  Boolean(\n    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||\n    env.SUPABASE_ANON_KEY ||\n    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||\n    process.env.SUPABASE_ANON_KEY\n  );\n\nconst packageJsonPath =\n  path.resolve(root, \"package.json\");\n\nlet packageJson = null;\n\nif (fs.existsSync(packageJsonPath)) {\n  packageJson =\n    JSON.parse(\n      fs.readFileSync(\n        packageJsonPath,\n        \"utf8\"\n      )\n    );\n}\n\nconst hasSupabaseCliDependency =\n  Boolean(\n    packageJson?.devDependencies?.supabase ||\n    packageJson?.dependencies?.supabase\n  );\n\nconst report = {\n  status:\n    \"ALPHA_V3_SUPABASE_LINK_READINESS_COMPLETE\",\n\n  projectRefFound:\n    Boolean(projectRef),\n\n  projectRef,\n\n  projectRefSource:\n    sourceVariable,\n\n  urlVariableNames,\n\n  accessTokenPresent,\n\n  serviceRolePresent,\n\n  anonKeyPresent,\n\n  hasSupabaseCliDependency,\n\n  configExists:\n    fs.existsSync(\n      path.resolve(\n        root,\n        \"supabase/config.toml\"\n      )\n    ),\n\n  secretsPrinted:\n    false,\n\n  decision: {\n    readyForNonInteractiveLink:\n      Boolean(projectRef) &&\n      accessTokenPresent,\n\n    readyForInteractiveLink:\n      Boolean(projectRef),\n\n    preferredNext:\n      Boolean(projectRef) &&\n      accessTokenPresent\n        ? \"INSTALL_CLI_AND_LINK_NONINTERACTIVELY\"\n        : Boolean(projectRef)\n          ? \"INSTALL_CLI_THEN_LOGIN_AND_LINK\"\n          : \"OBTAIN_PROJECT_REF_FROM_SUPABASE_DASHBOARD\",\n\n    nextGate:\n      Boolean(projectRef)\n        ? \"ESTABLISH_SUPABASE_CLI_LINK\"\n        : \"PROJECT_REF_REQUIRED\",\n  },\n\n  outputFile:\n    \"logs/alpha-v3-supabase-link-readiness.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(\n    path.resolve(root, report.outputFile)\n  ),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  path.resolve(root, report.outputFile),\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      projectRefFound:\n        report.projectRefFound,\n\n      projectRef:\n        report.projectRef,\n\n      projectRefSource:\n        report.projectRefSource,\n\n      accessTokenPresent:\n        report.accessTokenPresent,\n\n      serviceRolePresent:\n        report.serviceRolePresent,\n\n      hasSupabaseCliDependency:\n        report.hasSupabaseCliDependency,\n\n      configExists:\n        report.configExists,\n\n      readyForNonInteractiveLink:\n        report.decision.readyForNonInteractiveLink,\n\n      readyForInteractiveLink:\n        report.decision.readyForInteractiveLink,\n\n      preferredNext:\n        report.decision.preferredNext,\n\n      nextGate:\n        report.decision.nextGate,\n\n      outputFile:\n        report.outputFile,\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_SUPABASE_LINK_READINESS_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-supabase-link-readiness.cjs",

      secretsPrinted:
        false,

      databaseWrites:
        0,

      nextAction:
        "RUN_SUPABASE_LINK_READINESS"
    },
    null,
    2
  )
);
