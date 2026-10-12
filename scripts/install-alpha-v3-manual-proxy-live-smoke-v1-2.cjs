const fs = require("fs");
const path = require("path");

const root = process.cwd();

const smokeFile = path.resolve(
  root,
  "scripts/alpha-v3-manual-proxy-probe-only-live-smoke.cjs"
);

if (!fs.existsSync(smokeFile)) {
  throw new Error(
    "MANUAL_PROXY_LIVE_SMOKE_NOT_FOUND"
  );
}

let text =
  fs.readFileSync(
    smokeFile,
    "utf8"
  );

const backup =
  `${smokeFile}.before-v1-2.bak`;

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    smokeFile,
    backup
  );
}

text =
  text.replace(
    "      1200\n",
    "      8000\n"
  );

const oldLoop =
`  for (
    const candidate of
      candidates
  ) {
    if (
      await reachable(
        candidate
      )
    ) {
      return candidate;
    }
  }

  return null;`;

const newLoop =
`  for (
    let attempt = 1;
    attempt <= 3;
    attempt += 1
  ) {
    for (
      const candidate of
        candidates
    ) {
      if (
        await reachable(
          candidate
        )
      ) {
        return candidate;
      }
    }

    if (attempt < 3) {
      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            750
          )
      );
    }
  }

  return null;`;

if (
  text.includes(oldLoop)
) {
  text =
    text.replace(
      oldLoop,
      newLoop
    );
} else if (
  !text.includes(
    "attempt <= 3"
  )
) {
  throw new Error(
    "SERVER_DETECTION_LOOP_NOT_FOUND"
  );
}

fs.writeFileSync(
  smokeFile,
  text,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_MANUAL_PROXY_LIVE_SMOKE_V1_2_INSTALLED",

      patchedFile:
        "scripts/alpha-v3-manual-proxy-probe-only-live-smoke.cjs",

      rootCause:
        "NEXT_DEV_COLD_START_EXCEEDED_1200MS_REACHABILITY_TIMEOUT",

      fix: {
        reachabilityTimeoutMs:
          8000,

        attempts:
          3,

        retryDelayMs:
          750
      },

      productionCodeChanged:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      nextAction:
        "RERUN_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE"
    },
    null,
    2
  )
);
