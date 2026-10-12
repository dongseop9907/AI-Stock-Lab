const fs = require("fs");
const path = require("path");

const CHECKPOINT = path.resolve(
  process.cwd(),
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json"
);

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function shape(v, depth = 0) {
  if (depth >= 3) {
    if (Array.isArray(v)) return `[Array(${v.length})]`;
    if (isObj(v)) return `{${Object.keys(v).join(",")}}`;
    return v;
  }

  if (Array.isArray(v)) {
    return {
      type: "array",
      length: v.length,
      sample: v.length ? shape(v[0], depth + 1) : null
    };
  }

  if (isObj(v)) {
    const out = {};
    for (const [k, child] of Object.entries(v)) {
      out[k] = shape(child, depth + 1);
    }
    return out;
  }

  return v;
}

if (!fs.existsSync(CHECKPOINT)) {
  throw new Error("CHECKPOINT_NOT_FOUND");
}

const data = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));

const results = Array.isArray(data.results)
  ? data.results
  : Array.isArray(data.sessions)
    ? data.sessions
    : Array.isArray(data.replay)
      ? data.replay
      : [];

const samples = results.slice(0, 3).map((row, index) => ({
  index,
  topLevelKeys: isObj(row) ? Object.keys(row) : [],
  shape: shape(row)
}));

console.log(JSON.stringify({
  status: "ALPHA_V3_ENTRY_V3_CHECKPOINT_SCHEMA_PROBE_COMPLETE",
  checkpointTopLevelKeys: isObj(data) ? Object.keys(data) : [],
  detectedArray: Array.isArray(data.results)
    ? "results"
    : Array.isArray(data.sessions)
      ? "sessions"
      : Array.isArray(data.replay)
        ? "replay"
        : "NONE",
  detectedCount: results.length,
  samples,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    kisRequests: 0,
    ordersCreated: 0,
    productionChanged: false
  },
  nextGate: "FIX_ENTRY_V3_CHRONOLOGICAL_VALIDATOR_SCHEMA"
}, null, 2));
