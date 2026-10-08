const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-entry-v3-checkpoint-schema-probe.cjs"
);

const source = "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst CHECKPOINT = path.resolve(\n  process.cwd(),\n  \"logs/alpha-v3-extended-entry-v3-replay-checkpoint.json\"\n);\n\nfunction isObj(v) {\n  return v && typeof v === \"object\" && !Array.isArray(v);\n}\n\nfunction shape(v, depth = 0) {\n  if (depth >= 3) {\n    if (Array.isArray(v)) return `[Array(${v.length})]`;\n    if (isObj(v)) return `{${Object.keys(v).join(\",\")}}`;\n    return v;\n  }\n\n  if (Array.isArray(v)) {\n    return {\n      type: \"array\",\n      length: v.length,\n      sample: v.length ? shape(v[0], depth + 1) : null\n    };\n  }\n\n  if (isObj(v)) {\n    const out = {};\n    for (const [k, child] of Object.entries(v)) {\n      out[k] = shape(child, depth + 1);\n    }\n    return out;\n  }\n\n  return v;\n}\n\nif (!fs.existsSync(CHECKPOINT)) {\n  throw new Error(\"CHECKPOINT_NOT_FOUND\");\n}\n\nconst data = JSON.parse(fs.readFileSync(CHECKPOINT, \"utf8\"));\n\nconst results = Array.isArray(data.results)\n  ? data.results\n  : Array.isArray(data.sessions)\n    ? data.sessions\n    : Array.isArray(data.replay)\n      ? data.replay\n      : [];\n\nconst samples = results.slice(0, 3).map((row, index) => ({\n  index,\n  topLevelKeys: isObj(row) ? Object.keys(row) : [],\n  shape: shape(row)\n}));\n\nconsole.log(JSON.stringify({\n  status: \"ALPHA_V3_ENTRY_V3_CHECKPOINT_SCHEMA_PROBE_COMPLETE\",\n  checkpointTopLevelKeys: isObj(data) ? Object.keys(data) : [],\n  detectedArray: Array.isArray(data.results)\n    ? \"results\"\n    : Array.isArray(data.sessions)\n      ? \"sessions\"\n      : Array.isArray(data.replay)\n        ? \"replay\"\n        : \"NONE\",\n  detectedCount: results.length,\n  samples,\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    kisRequests: 0,\n    ordersCreated: 0,\n    productionChanged: false\n  },\n  nextGate: \"FIX_ENTRY_V3_CHRONOLOGICAL_VALIDATOR_SCHEMA\"\n}, null, 2));\n";

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, source, "utf8");

console.log(JSON.stringify({
  status: "ALPHA_V3_ENTRY_V3_CHECKPOINT_SCHEMA_PROBE_INSTALLED",
  generatedFile: "scripts/alpha-v3-entry-v3-checkpoint-schema-probe.cjs",
  productionChanged: false,
  databaseWrites: 0,
  ordersCreated: 0,
  nextAction: "RUN_ENTRY_V3_CHECKPOINT_SCHEMA_PROBE"
}, null, 2));
