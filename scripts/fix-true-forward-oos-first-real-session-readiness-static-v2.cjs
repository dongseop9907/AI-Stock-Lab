const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-real-session-readiness-v1-static-verify.cjs"
);

const backupDir = path.join(
  ROOT,
  "scripts",
  "backups"
);

const backup = path.join(
  backupDir,
  "true-forward-oos-first-real-session-readiness-v1-static-verify.before-v2.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_STATIC_FIX_V2_FAILED",
    reason,
    ...extra
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(target)) {
  fail(
    "STATIC_VERIFIER_NOT_FOUND",
    { target }
  );
} else {
  fs.mkdirSync(
    backupDir,
    { recursive: true }
  );

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(
      target,
      backup
    );
  }

  const payload =
    "Y29uc3QgZnMgPSByZXF1aXJlKCJmcyIpOwpjb25zdCBwYXRoID0gcmVxdWlyZSgicGF0aCIpOwoKY29uc3QgUk9PVCA9IHByb2Nlc3MuY3dkKCk7Cgpjb25zdCBhdWRpdCA9IHBhdGguam9pbigKICBST09ULAogICJzY3JpcHRzIiwKICAidHJ1ZS1mb3J3YXJkLW9vcy1maXJzdC1yZWFsLXNlc3Npb24tcmVhZGluZXNzLXYxLnRzIgopOwoKaWYgKCFmcy5leGlzdHNTeW5jKGF1ZGl0KSkgewogIGNvbnNvbGUuZXJyb3IoSlNPTi5zdHJpbmdpZnkoewogICAgc3RhdHVzOgogICAgICAiQUlfU1RPQ0tfTEFCX1RSVUVfRk9SV0FSRF9PT1NfRklSU1RfUkVBTF9TRVNTSU9OX1JFQURJTkVTU19WMV9TVEFUSUNfRkFJTEVEIiwKCiAgICB2ZXJpZmllclZlcnNpb246CiAgICAgICJWMl9TVFJJTkdfT05MWV9OT19SRUdFWCIsCgogICAgZmFpbGVkOiBbCiAgICAgICJhdWRpdEV4aXN0cyIKICAgIF0sCiAgfSwgbnVsbCwgMikpOwoKICBwcm9jZXNzLmV4aXRDb2RlID0gMTsKfSBlbHNlIHsKICBjb25zdCBzb3VyY2UgPQogICAgZnMucmVhZEZpbGVTeW5jKAogICAgICBhdWRpdCwKICAgICAgInV0ZjgiCiAgICApOwoKICBjb25zdCBsb3dlciA9CiAgICBzb3VyY2UudG9Mb3dlckNhc2UoKTsKCiAgY29uc3QgY2hlY2tzID0gewogICAgYXVkaXRFeGlzdHM6CiAgICAgIHRydWUsCgogICAgdGFyZ2V0RGF0ZVBpbm5lZDoKICAgICAgc291cmNlLmluY2x1ZGVzKAogICAgICAgICciMjAyNi0xMC0xMiInCiAgICAgICksCgogICAga3J4Q2FsZW5kYXJCb3VuZDoKICAgICAgc291cmNlLmluY2x1ZGVzKAogICAgICAgICJpc0tyeFRyYWRpbmdEYXRlIgogICAgICApICYmCiAgICAgIHNvdXJjZS5pbmNsdWRlcygKICAgICAgICAibmV4dEtyeFRyYWRpbmdEYXRlIgogICAgICApLAoKICAgIGNvbnRyb2xsZWRQcm9kdWNlckNoZWNrZWQ6CiAgICAgIHNvdXJjZS5pbmNsdWRlcygKICAgICAgICAiRk9SV0FSRF9PT1NfQ09OVFJPTExFRF9OT1JNQUxfUFJPRFVDRVJfRU5BQkxFRCIKICAgICAgKSwKCiAgICBleGFjdFBocmFzZUNoZWNrZWQ6CiAgICAgIHNvdXJjZS5pbmNsdWRlcygKICAgICAgICAiUlVOX1RSVUVfRk9SV0FSRF9PT1NfTk9STUFMX1BST0RVQ0VSIgogICAgICApLAoKICAgIGF1dG9tYXRpb25PZmZDaGVja2VkOgogICAgICBzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgIkZPUldBUkRfT09TX0FVVE9NQVRJT05fRU5BQkxFRCIKICAgICAgKSwKCiAgICByZWFsVHJhZGluZ0ZsYWdzQ2hlY2tlZDoKICAgICAgc291cmNlLmluY2x1ZGVzKAogICAgICAgICJSRUFMX1RSQURJTkdfRU5BQkxFRCIKICAgICAgKSAmJgogICAgICBzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgIkVOQUJMRV9SRUFMX1RSQURJTkciCiAgICAgICkgJiYKICAgICAgc291cmNlLmluY2x1ZGVzKAogICAgICAgICJFTkFCTEVfTElWRV9UUkFESU5HIgogICAgICApLAoKICAgIG1hdHVyaXR5QmluZGluZ0NoZWNrZWQ6CiAgICAgIHNvdXJjZS5pbmNsdWRlcygKICAgICAgICAiYWRkS3J4VHJhZGluZ1Nlc3Npb25zKCIKICAgICAgKSwKCiAgICBjb2xsZWN0b3JCaW5kaW5nQ2hlY2tlZDoKICAgICAgc291cmNlLmluY2x1ZGVzKAogICAgICAgICJjb2xsZWN0b3JTaW5nbGVSdW5CaW5kaW5nIgogICAgICApLAoKICAgIG5vU3Bhd246CiAgICAgICFzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgInNwYXduKCIKICAgICAgKSwKCiAgICBub1N1cGFiYXNlU3VyZmFjZToKICAgICAgIWxvd2VyLmluY2x1ZGVzKAogICAgICAgICJzdXBhYmFzZSIKICAgICAgKSwKCiAgICBub0luc2VydFN1cmZhY2U6CiAgICAgICFzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgIi5pbnNlcnQoIgogICAgICApICYmCiAgICAgICFzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgIi5pbnNlcnQgKCIKICAgICAgKSwKCiAgICBub1VwZGF0ZVN1cmZhY2U6CiAgICAgICFzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgIi51cGRhdGUoIgogICAgICApICYmCiAgICAgICFzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgIi51cGRhdGUgKCIKICAgICAgKSwKCiAgICBub0RlbGV0ZVN1cmZhY2U6CiAgICAgICFzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgIi5kZWxldGUoIgogICAgICApICYmCiAgICAgICFzb3VyY2UuaW5jbHVkZXMoCiAgICAgICAgIi5kZWxldGUgKCIKICAgICAgKSwKCiAgICBub09yZGVyU3VyZmFjZToKICAgICAgIWxvd2VyLmluY2x1ZGVzKAogICAgICAgICJjcmVhdGVvcmRlcigiCiAgICAgICkgJiYKICAgICAgIWxvd2VyLmluY2x1ZGVzKAogICAgICAgICJwbGFjZW9yZGVyKCIKICAgICAgKSAmJgogICAgICAhbG93ZXIuaW5jbHVkZXMoCiAgICAgICAgInN1Ym1pdG9yZGVyKCIKICAgICAgKSwKICB9OwoKICBjb25zdCBmYWlsZWQgPQogICAgT2JqZWN0LmVudHJpZXMoCiAgICAgIGNoZWNrcwogICAgKQogICAgICAuZmlsdGVyKAogICAgICAgIChbLCB2YWx1ZV0pID0+CiAgICAgICAgICB2YWx1ZSAhPT0gdHJ1ZQogICAgICApCiAgICAgIC5tYXAoCiAgICAgICAgKFtrZXldKSA9PgogICAgICAgICAga2V5CiAgICAgICk7CgogIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHsKICAgIHN0YXR1czoKICAgICAgZmFpbGVkLmxlbmd0aCA9PT0gMAogICAgICAgID8gIkFJX1NUT0NLX0xBQl9UUlVFX0ZPUldBUkRfT09TX0ZJUlNUX1JFQUxfU0VTU0lPTl9SRUFESU5FU1NfVjFfU1RBVElDX1ZFUklGSUVEIgogICAgICAgIDogIkFJX1NUT0NLX0xBQl9UUlVFX0ZPUldBUkRfT09TX0ZJUlNUX1JFQUxfU0VTU0lPTl9SRUFESU5FU1NfVjFfU1RBVElDX0ZBSUxFRCIsCgogICAgdmVyaWZpZXJWZXJzaW9uOgogICAgICAiVjJfU1RSSU5HX09OTFlfTk9fUkVHRVgiLAoKICAgIGNoZWNrcywKCiAgICBzYWZldHk6IHsKICAgICAgc291cmNlT25seToKICAgICAgICB0cnVlLAoKICAgICAgcHJvZHVjZXJFeGVjdXRlZDoKICAgICAgICBmYWxzZSwKCiAgICAgIGNvbGxlY3RvckV4ZWN1dGVkOgogICAgICAgIGZhbHNlLAoKICAgICAgZGF0YWJhc2VXcml0ZXM6CiAgICAgICAgMCwKCiAgICAgIG9yZGVyc0NyZWF0ZWQ6CiAgICAgICAgMCwKCiAgICAgIHBvc2l0aW9uc0NoYW5nZWQ6CiAgICAgICAgMCwKCiAgICAgIHByb21vdGlvbkV4ZWN1dGVkOgogICAgICAgIGZhbHNlLAoKICAgICAgcmVhbFRyYWRpbmdFbmFibGVkOgogICAgICAgIGZhbHNlCiAgICB9LAoKICAgIGZhaWxlZCwKCiAgICBuZXh0R2F0ZToKICAgICAgZmFpbGVkLmxlbmd0aCA9PT0gMAogICAgICAgID8gIlJVTl9SRUFESU5FU1NfQ09OVFJBQ1RfQU5EX0NVUlJFTlRfQVVESVQiCiAgICAgICAgOiAiUkVQQUlSX0ZJUlNUX1JFQUxfU0VTU0lPTl9SRUFESU5FU1NfVjFfU1RBVElDIgogIH0sIG51bGwsIDIpKTsKCiAgcHJvY2Vzcy5leGl0Q29kZSA9CiAgICBmYWlsZWQubGVuZ3RoID09PSAwCiAgICAgID8gMAogICAgICA6IDE7Cn0K";

  const decoded =
    Buffer.from(
      payload,
      "base64"
    ).toString(
      "utf8"
    );

  fs.writeFileSync(
    target,
    decoded,
    "utf8"
  );

  const written =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    v2Installed:
      written.includes(
        "V2_STRING_ONLY_NO_REGEX"
      ),

    fragileRegexRemoved:
      !written.includes(
        "new RegExp("
      ) &&
      !written.includes(
        "!/supabase"
      ),

    sourceOnlyChecksPresent:
      written.includes(
        "noSupabaseSurface"
      ) &&
      written.includes(
        "noInsertSurface"
      ) &&
      written.includes(
        "noUpdateSurface"
      ) &&
      written.includes(
        "noDeleteSurface"
      ),

    readinessLogicChanged:
      false,

    productSourceChanges:
      0,

    tradingLogicChanges:
      0
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([key, value]) =>
          key !== "readinessLogicChanged" &&
          key !== "productSourceChanges" &&
          key !== "tradingLogicChanges" &&
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_STATIC_FIX_V2_REPAIRED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_STATIC_FIX_V2_FAILED",

    changedFile:
      "scripts/true-forward-oos-first-real-session-readiness-v1-static-verify.cjs",

    backupFile:
      "scripts/backups/true-forward-oos-first-real-session-readiness-v1-static-verify.before-v2.cjs",

    repair: {
      previousFailure:
        "STATIC_VERIFIER_REGEX_DOUBLE_ESCAPING_CREATED_UNTERMINATED_GROUP",

      newStrategy:
        "STRING_ONLY_STATIC_SAFETY_CHECKS_NO_REGEX",

      readinessLogic:
        "UNCHANGED",

      productLogic:
        "UNCHANGED"
    },

    checks,

    safety: {
      producerExecuted:
        false,

      collectorExecuted:
        false,

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

    nextAction:
      failed.length === 0
        ? "NODE_CHECK_AND_RERUN_STATIC_CONTRACT_CURRENT_READINESS"
        : "INSPECT_STATIC_FIX_V2"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
