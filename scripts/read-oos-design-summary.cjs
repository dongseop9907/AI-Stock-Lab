const fs = require("fs");

const r = JSON.parse(
  fs.readFileSync(
    "./logs/true-forward-oos-automation-binding-design-probe-v1.json",
    "utf8"
  ).replace(/^\uFEFF/, "")
);

console.log(JSON.stringify({
  recommendedStrategy: r.recommendedStrategy,
  importable: r.importable,
  risks: r.risks,
  hardFailures: r.hardFailures,
  nextGate: r.nextGate
}, null, 2));
