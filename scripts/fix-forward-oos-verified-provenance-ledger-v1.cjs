const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = {
  helper:
    "lib/research/forward-oos-verified-provenance-ledger-v1.ts",
  evidence:
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  dashboard:
    "lib/research/get-forward-oos-observability-dashboard-v1.ts",
  monitor:
    "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  contract:
    "scripts/forward-oos-verified-provenance-ledger-v1-contract-test.ts",
  static:
    "scripts/forward-oos-verified-provenance-ledger-v1-static-verify.cjs",
};

function abs(rel) {
  return path.join(ROOT, rel);
}

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_VERIFIED_PROVENANCE_LEDGER_V1_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}

function readRequired(rel) {
  const file = abs(rel);

  if (!fs.existsSync(file)) {
    throw new Error(
      "REQUIRED_FILE_NOT_FOUND:" +
      rel
    );
  }

  return fs.readFileSync(
    file,
    "utf8"
  );
}

function backup(rel) {
  const dir =
    path.join(
      ROOT,
      "scripts",
      "backups"
    );

  fs.mkdirSync(
    dir,
    { recursive: true }
  );

  const name =
    rel
      .replaceAll("/", "__")
      .replaceAll("\\", "__")
      .replace(/\.ts$/, "") +
    ".before-verified-provenance-ledger-v1.ts";

  const dst =
    path.join(
      dir,
      name
    );

  if (!fs.existsSync(dst)) {
    fs.copyFileSync(
      abs(rel),
      dst
    );
  }

  return path
    .relative(ROOT, dst)
    .replaceAll("\\", "/");
}

function replaceOnce(
  text,
  from,
  to,
  label
) {
  if (text.includes(to)) {
    return text;
  }

  const count =
    text.split(from).length - 1;

  if (count !== 1) {
    throw new Error(
      label +
      "_EXPECTED_ONCE_ACTUAL_" +
      count
    );
  }

  return text.replace(from, to);
}

let evidence;
let dashboard;
let monitor;

try {
  evidence =
    readRequired(
      FILES.evidence
    );

  dashboard =
    readRequired(
      FILES.dashboard
    );

  monitor =
    readRequired(
      FILES.monitor
    );
}
catch (error) {
  fail(
    "SOURCE_READ_FAILED",
    {
      error:
        String(
          error instanceof Error
            ? error.message
            : error
        )
    }
  );
  return;
}

const backups = [
  backup(FILES.evidence),
  backup(FILES.dashboard),
  backup(FILES.monitor),
];

try {
  fs.writeFileSync(
    abs(FILES.helper),
    Buffer.from(
      "aW1wb3J0IGNyeXB0byBmcm9tICJub2RlOmNyeXB0byI7CmltcG9ydCBmcyBmcm9tICJub2RlOmZzIjsKaW1wb3J0IHBhdGggZnJvbSAibm9kZTpwYXRoIjsKCmV4cG9ydCBjb25zdCBWRVJJRklFRF9GT1JXQVJEX09PU19QUk9WRU5BTkNFX0xFREdFUl9WMSA9CiAgImxvZ3MvdHJ1ZS1mb3J3YXJkLW9vcy1jb250cm9sbGVkLXByb2R1Y2VyLWV2aWRlbmNlLWxlZGdlci12MS5qc29ubCI7CgpleHBvcnQgY29uc3QgVkVSSUZJRURfRk9SV0FSRF9PT1NfUFJPVkVOQU5DRV9MRURHRVJfU0NIRU1BX1YxID0KICAiRk9SV0FSRF9PT1NfVkVSSUZJRURfUFJPVkVOQU5DRV9MRURHRVJfVjEiIGFzIGNvbnN0OwoKdHlwZSBKc29uUmVjb3JkID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj47CgpleHBvcnQgaW50ZXJmYWNlIFZlcmlmaWVkRm9yd2FyZE9vc1Byb3ZlbmFuY2VMZWRnZXJFbnRyeVYxIHsKICBzY2hlbWFWZXJzaW9uOgogICAgdHlwZW9mIFZFUklGSUVEX0ZPUldBUkRfT09TX1BST1ZFTkFOQ0VfTEVER0VSX1NDSEVNQV9WMTsKICB2ZXJpZmllZEF0OiBzdHJpbmc7CiAgcnVuSWQ6IHN0cmluZzsKICBtb2RlOiAiQ09OVFJPTExFRF9OT1JNQUwiOwogIGV2aWRlbmNlU3RhdHVzOiBzdHJpbmc7CiAgZXZpZGVuY2VGaWxlOiBzdHJpbmc7CiAgc2Vzc2lvbkZpbGU6IHN0cmluZyB8IG51bGw7CiAgYmVmb3JlSGFzaDogc3RyaW5nIHwgbnVsbDsKICBhZnRlckhhc2g6IHN0cmluZyB8IG51bGw7CiAgc2Vzc2lvbkRlbHRhOiBudW1iZXI7CiAgc2Vzc2lvbnM6IEFycmF5PHsKICAgIHNlc3Npb25LZXk6IHN0cmluZzsKICAgIHNvdXJjZVRyYWRpbmdEYXRlOiBzdHJpbmcgfCBudWxsOwogICAgdGFyZ2V0U2Vzc2lvbkRhdGU6IHN0cmluZyB8IG51bGw7CiAgICBzdG9ja0NvZGU6IHN0cmluZyB8IG51bGw7CiAgICBjYW5kaWRhdGVGaW5nZXJwcmludDogc3RyaW5nOwogICAgaW50ZWdyaXR5UGF5bG9hZEhhc2g6IHN0cmluZzsKICB9PjsKICBwcmV2aW91c0VudHJ5SGFzaDogc3RyaW5nIHwgbnVsbDsKICBlbnRyeUhhc2g6IHN0cmluZzsKfQoKZXhwb3J0IGludGVyZmFjZSBWZXJpZmllZEZvcndhcmRPb3NQcm92ZW5hbmNlTGVkZ2VyU25hcHNob3RWMSB7CiAgZXhpc3RzOiBib29sZWFuOwogIGZpbGU6IHN0cmluZzsKICBlbnRyaWVzOiBWZXJpZmllZEZvcndhcmRPb3NQcm92ZW5hbmNlTGVkZ2VyRW50cnlWMVtdOwogIGludmFsaWRMaW5lQ291bnQ6IG51bWJlcjsKICBjaGFpblZhbGlkOiBib29sZWFuOwogIGR1cGxpY2F0ZVJ1bklkczogc3RyaW5nW107CiAgdmFsaWQ6IGJvb2xlYW47Cn0KCmZ1bmN0aW9uIGFzUmVjb3JkKHZhbHVlOiB1bmtub3duKTogSnNvblJlY29yZCB8IG51bGwgewogIHJldHVybiAoCiAgICB2YWx1ZSAhPT0gbnVsbCAmJgogICAgdHlwZW9mIHZhbHVlID09PSAib2JqZWN0IiAmJgogICAgIUFycmF5LmlzQXJyYXkodmFsdWUpCiAgKQogICAgPyB2YWx1ZSBhcyBKc29uUmVjb3JkCiAgICA6IG51bGw7Cn0KCmZ1bmN0aW9uIHRleHQodmFsdWU6IHVua25vd24pIHsKICByZXR1cm4gKAogICAgdHlwZW9mIHZhbHVlID09PSAic3RyaW5nIiAmJgogICAgdmFsdWUubGVuZ3RoID4gMAogICkKICAgID8gdmFsdWUKICAgIDogbnVsbDsKfQoKZnVuY3Rpb24gaXNTaGEyNTYodmFsdWU6IHVua25vd24pIHsKICByZXR1cm4gKAogICAgdHlwZW9mIHZhbHVlID09PSAic3RyaW5nIiAmJgogICAgL15bYS1mMC05XXs2NH0kL2kudGVzdCh2YWx1ZSkKICApOwp9CgpmdW5jdGlvbiBjYW5vbmljYWwodmFsdWU6IHVua25vd24pOiBzdHJpbmcgewogIGlmICgKICAgIHZhbHVlID09PSBudWxsIHx8CiAgICB0eXBlb2YgdmFsdWUgPT09ICJzdHJpbmciIHx8CiAgICB0eXBlb2YgdmFsdWUgPT09ICJudW1iZXIiIHx8CiAgICB0eXBlb2YgdmFsdWUgPT09ICJib29sZWFuIgogICkgewogICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlKTsKICB9CgogIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7CiAgICByZXR1cm4gIm51bGwiOwogIH0KCiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7CiAgICByZXR1cm4gKAogICAgICAiWyIgKwogICAgICB2YWx1ZS5tYXAoY2Fub25pY2FsKS5qb2luKCIsIikgKwogICAgICAiXSIKICAgICk7CiAgfQoKICBjb25zdCByb3cgPSBhc1JlY29yZCh2YWx1ZSk7CgogIGlmICghcm93KSB7CiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoU3RyaW5nKHZhbHVlKSk7CiAgfQoKICByZXR1cm4gKAogICAgInsiICsKICAgIE9iamVjdC5rZXlzKHJvdykKICAgICAgLnNvcnQoKQogICAgICAubWFwKAogICAgICAgIGtleSA9PgogICAgICAgICAgSlNPTi5zdHJpbmdpZnkoa2V5KSArCiAgICAgICAgICAiOiIgKwogICAgICAgICAgY2Fub25pY2FsKHJvd1trZXldKSwKICAgICAgKQogICAgICAuam9pbigiLCIpICsKICAgICJ9IgogICk7Cn0KCmZ1bmN0aW9uIHNoYTI1Nih2YWx1ZTogdW5rbm93bikgewogIHJldHVybiBjcnlwdG8KICAgIC5jcmVhdGVIYXNoKCJzaGEyNTYiKQogICAgLnVwZGF0ZShjYW5vbmljYWwodmFsdWUpKQogICAgLmRpZ2VzdCgiaGV4Iik7Cn0KCmZ1bmN0aW9uIHN0b2NrQ29kZU9mKHJvdzogSnNvblJlY29yZCkgewogIGNvbnN0IHRvcDEgPSBhc1JlY29yZChyb3cudG9wMSk7CgogIHJldHVybiAoCiAgICB0ZXh0KHJvdy5zdG9ja0NvZGUpID8/CiAgICB0ZXh0KHJvdy5zdG9ja19jb2RlKSA/PwogICAgdGV4dCh0b3AxPy5zdG9ja0NvZGUpID8/CiAgICB0ZXh0KHRvcDE/LnN0b2NrX2NvZGUpCiAgKTsKfQoKZXhwb3J0IGZ1bmN0aW9uIGZvcndhcmRPb3NTZXNzaW9uUHJvdmVuYW5jZUtleVYxKAogIHNlc3Npb246IHVua25vd24sCikgewogIGNvbnN0IHJvdyA9IGFzUmVjb3JkKHNlc3Npb24pOwoKICBpZiAoIXJvdykgewogICAgcmV0dXJuICJ8fCI7CiAgfQoKICByZXR1cm4gWwogICAgdGV4dChyb3cuc291cmNlVHJhZGluZ0RhdGUpID8/ICIiLAogICAgdGV4dChyb3cudGFyZ2V0U2Vzc2lvbkRhdGUpID8/ICIiLAogICAgc3RvY2tDb2RlT2Yocm93KSA/PyAiIiwKICBdLmpvaW4oInwiKTsKfQoKZnVuY3Rpb24gc2Vzc2lvbkF0dGVzdGF0aW9uKHNlc3Npb246IHVua25vd24pIHsKICBjb25zdCByb3cgPSBhc1JlY29yZChzZXNzaW9uKTsKICBjb25zdCBpbnRlZ3JpdHkgPQogICAgYXNSZWNvcmQocm93Py5pbnRlZ3JpdHkpOwoKICByZXR1cm4gewogICAgc2Vzc2lvbktleToKICAgICAgZm9yd2FyZE9vc1Nlc3Npb25Qcm92ZW5hbmNlS2V5VjEoCiAgICAgICAgc2Vzc2lvbiwKICAgICAgKSwKICAgIHNvdXJjZVRyYWRpbmdEYXRlOgogICAgICB0ZXh0KHJvdz8uc291cmNlVHJhZGluZ0RhdGUpLAogICAgdGFyZ2V0U2Vzc2lvbkRhdGU6CiAgICAgIHRleHQocm93Py50YXJnZXRTZXNzaW9uRGF0ZSksCiAgICBzdG9ja0NvZGU6CiAgICAgIHJvdwogICAgICAgID8gc3RvY2tDb2RlT2Yocm93KQogICAgICAgIDogbnVsbCwKICAgIGNhbmRpZGF0ZUZpbmdlcnByaW50OgogICAgICB0ZXh0KHJvdz8uY2FuZGlkYXRlRmluZ2VycHJpbnQpID8/ICIiLAogICAgaW50ZWdyaXR5UGF5bG9hZEhhc2g6CiAgICAgIHRleHQoaW50ZWdyaXR5Py5wYXlsb2FkSGFzaCkgPz8gIiIsCiAgfTsKfQoKZnVuY3Rpb24gZW50cnlIYXNoSW5wdXQoCiAgZW50cnk6IE9taXQ8CiAgICBWZXJpZmllZEZvcndhcmRPb3NQcm92ZW5hbmNlTGVkZ2VyRW50cnlWMSwKICAgICJlbnRyeUhhc2giCiAgPiwKKSB7CiAgcmV0dXJuIHsKICAgIHNjaGVtYVZlcnNpb246IGVudHJ5LnNjaGVtYVZlcnNpb24sCiAgICB2ZXJpZmllZEF0OiBlbnRyeS52ZXJpZmllZEF0LAogICAgcnVuSWQ6IGVudHJ5LnJ1bklkLAogICAgbW9kZTogZW50cnkubW9kZSwKICAgIGV2aWRlbmNlU3RhdHVzOiBlbnRyeS5ldmlkZW5jZVN0YXR1cywKICAgIGV2aWRlbmNlRmlsZTogZW50cnkuZXZpZGVuY2VGaWxlLAogICAgc2Vzc2lvbkZpbGU6IGVudHJ5LnNlc3Npb25GaWxlLAogICAgYmVmb3JlSGFzaDogZW50cnkuYmVmb3JlSGFzaCwKICAgIGFmdGVySGFzaDogZW50cnkuYWZ0ZXJIYXNoLAogICAgc2Vzc2lvbkRlbHRhOiBlbnRyeS5zZXNzaW9uRGVsdGEsCiAgICBzZXNzaW9uczogZW50cnkuc2Vzc2lvbnMsCiAgICBwcmV2aW91c0VudHJ5SGFzaDoKICAgICAgZW50cnkucHJldmlvdXNFbnRyeUhhc2gsCiAgfTsKfQoKZnVuY3Rpb24gcGFyc2VFbnRyeSgKICB2YWx1ZTogdW5rbm93biwKKTogVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlckVudHJ5VjEgfCBudWxsIHsKICBjb25zdCByb3cgPSBhc1JlY29yZCh2YWx1ZSk7CgogIGlmICgKICAgICFyb3cgfHwKICAgIHJvdy5zY2hlbWFWZXJzaW9uICE9PQogICAgICBWRVJJRklFRF9GT1JXQVJEX09PU19QUk9WRU5BTkNFX0xFREdFUl9TQ0hFTUFfVjEgfHwKICAgIHJvdy5tb2RlICE9PSAiQ09OVFJPTExFRF9OT1JNQUwiIHx8CiAgICAhdGV4dChyb3cudmVyaWZpZWRBdCkgfHwKICAgICF0ZXh0KHJvdy5ydW5JZCkgfHwKICAgICF0ZXh0KHJvdy5ldmlkZW5jZVN0YXR1cykgfHwKICAgICF0ZXh0KHJvdy5ldmlkZW5jZUZpbGUpIHx8CiAgICB0eXBlb2Ygcm93LnNlc3Npb25EZWx0YSAhPT0gIm51bWJlciIgfHwKICAgICFOdW1iZXIuaXNGaW5pdGUocm93LnNlc3Npb25EZWx0YSkgfHwKICAgICFBcnJheS5pc0FycmF5KHJvdy5zZXNzaW9ucykgfHwKICAgICFpc1NoYTI1Nihyb3cuZW50cnlIYXNoKQogICkgewogICAgcmV0dXJuIG51bGw7CiAgfQoKICBjb25zdCBzZXNzaW9ucyA9CiAgICByb3cuc2Vzc2lvbnMubWFwKAogICAgICByYXcgPT4gewogICAgICAgIGNvbnN0IGl0ZW0gPSBhc1JlY29yZChyYXcpOwoKICAgICAgICBpZiAoIWl0ZW0pIHsKICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgIH0KCiAgICAgICAgY29uc3Qgc2Vzc2lvbktleSA9CiAgICAgICAgICB0ZXh0KGl0ZW0uc2Vzc2lvbktleSk7CiAgICAgICAgY29uc3QgY2FuZGlkYXRlRmluZ2VycHJpbnQgPQogICAgICAgICAgdGV4dChpdGVtLmNhbmRpZGF0ZUZpbmdlcnByaW50KTsKICAgICAgICBjb25zdCBpbnRlZ3JpdHlQYXlsb2FkSGFzaCA9CiAgICAgICAgICB0ZXh0KGl0ZW0uaW50ZWdyaXR5UGF5bG9hZEhhc2gpOwoKICAgICAgICBpZiAoCiAgICAgICAgICAhc2Vzc2lvbktleSB8fAogICAgICAgICAgIWlzU2hhMjU2KGNhbmRpZGF0ZUZpbmdlcnByaW50KSB8fAogICAgICAgICAgIWlzU2hhMjU2KGludGVncml0eVBheWxvYWRIYXNoKQogICAgICAgICkgewogICAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgICAgfQoKICAgICAgICByZXR1cm4gewogICAgICAgICAgc2Vzc2lvbktleSwKICAgICAgICAgIHNvdXJjZVRyYWRpbmdEYXRlOgogICAgICAgICAgICB0ZXh0KGl0ZW0uc291cmNlVHJhZGluZ0RhdGUpLAogICAgICAgICAgdGFyZ2V0U2Vzc2lvbkRhdGU6CiAgICAgICAgICAgIHRleHQoaXRlbS50YXJnZXRTZXNzaW9uRGF0ZSksCiAgICAgICAgICBzdG9ja0NvZGU6CiAgICAgICAgICAgIHRleHQoaXRlbS5zdG9ja0NvZGUpLAogICAgICAgICAgY2FuZGlkYXRlRmluZ2VycHJpbnQ6CiAgICAgICAgICAgIGNhbmRpZGF0ZUZpbmdlcnByaW50IGFzIHN0cmluZywKICAgICAgICAgIGludGVncml0eVBheWxvYWRIYXNoOgogICAgICAgICAgICBpbnRlZ3JpdHlQYXlsb2FkSGFzaCBhcyBzdHJpbmcsCiAgICAgICAgfTsKICAgICAgfSwKICAgICk7CgogIGlmICgKICAgIHNlc3Npb25zLnNvbWUoCiAgICAgIGl0ZW0gPT4gaXRlbSA9PT0gbnVsbCwKICAgICkKICApIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgY29uc3QgcHJldmlvdXNFbnRyeUhhc2ggPQogICAgcm93LnByZXZpb3VzRW50cnlIYXNoID09PSBudWxsCiAgICAgID8gbnVsbAogICAgICA6IHRleHQocm93LnByZXZpb3VzRW50cnlIYXNoKTsKCiAgaWYgKAogICAgcm93LnByZXZpb3VzRW50cnlIYXNoICE9PSBudWxsICYmCiAgICAhaXNTaGEyNTYocHJldmlvdXNFbnRyeUhhc2gpCiAgKSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIHJldHVybiB7CiAgICBzY2hlbWFWZXJzaW9uOgogICAgICBWRVJJRklFRF9GT1JXQVJEX09PU19QUk9WRU5BTkNFX0xFREdFUl9TQ0hFTUFfVjEsCiAgICB2ZXJpZmllZEF0OgogICAgICBTdHJpbmcocm93LnZlcmlmaWVkQXQpLAogICAgcnVuSWQ6CiAgICAgIFN0cmluZyhyb3cucnVuSWQpLAogICAgbW9kZToKICAgICAgIkNPTlRST0xMRURfTk9STUFMIiwKICAgIGV2aWRlbmNlU3RhdHVzOgogICAgICBTdHJpbmcocm93LmV2aWRlbmNlU3RhdHVzKSwKICAgIGV2aWRlbmNlRmlsZToKICAgICAgU3RyaW5nKHJvdy5ldmlkZW5jZUZpbGUpLAogICAgc2Vzc2lvbkZpbGU6CiAgICAgIHJvdy5zZXNzaW9uRmlsZSA9PT0gbnVsbAogICAgICAgID8gbnVsbAogICAgICAgIDogdGV4dChyb3cuc2Vzc2lvbkZpbGUpLAogICAgYmVmb3JlSGFzaDoKICAgICAgcm93LmJlZm9yZUhhc2ggPT09IG51bGwKICAgICAgICA/IG51bGwKICAgICAgICA6IHRleHQocm93LmJlZm9yZUhhc2gpLAogICAgYWZ0ZXJIYXNoOgogICAgICByb3cuYWZ0ZXJIYXNoID09PSBudWxsCiAgICAgICAgPyBudWxsCiAgICAgICAgOiB0ZXh0KHJvdy5hZnRlckhhc2gpLAogICAgc2Vzc2lvbkRlbHRhOgogICAgICBOdW1iZXIocm93LnNlc3Npb25EZWx0YSksCiAgICBzZXNzaW9uczoKICAgICAgc2Vzc2lvbnMgYXMgVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlckVudHJ5VjFbInNlc3Npb25zIl0sCiAgICBwcmV2aW91c0VudHJ5SGFzaCwKICAgIGVudHJ5SGFzaDoKICAgICAgU3RyaW5nKHJvdy5lbnRyeUhhc2gpLAogIH07Cn0KCmV4cG9ydCBmdW5jdGlvbiByZWFkVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlclYxKAogIHJvb3QgPSBwcm9jZXNzLmN3ZCgpLAopOiBWZXJpZmllZEZvcndhcmRPb3NQcm92ZW5hbmNlTGVkZ2VyU25hcHNob3RWMSB7CiAgY29uc3QgYWJzb2x1dGUgPQogICAgcGF0aC5qb2luKAogICAgICByb290LAogICAgICBWRVJJRklFRF9GT1JXQVJEX09PU19QUk9WRU5BTkNFX0xFREdFUl9WMSwKICAgICk7CgogIGlmICghZnMuZXhpc3RzU3luYyhhYnNvbHV0ZSkpIHsKICAgIHJldHVybiB7CiAgICAgIGV4aXN0czogZmFsc2UsCiAgICAgIGZpbGU6CiAgICAgICAgVkVSSUZJRURfRk9SV0FSRF9PT1NfUFJPVkVOQU5DRV9MRURHRVJfVjEsCiAgICAgIGVudHJpZXM6IFtdLAogICAgICBpbnZhbGlkTGluZUNvdW50OiAwLAogICAgICBjaGFpblZhbGlkOiB0cnVlLAogICAgICBkdXBsaWNhdGVSdW5JZHM6IFtdLAogICAgICB2YWxpZDogdHJ1ZSwKICAgIH07CiAgfQoKICBjb25zdCBsaW5lcyA9CiAgICBmcy5yZWFkRmlsZVN5bmMoCiAgICAgIGFic29sdXRlLAogICAgICAidXRmOCIsCiAgICApCiAgICAgIC5zcGxpdCgvXHI/XG4vKQogICAgICAuZmlsdGVyKAogICAgICAgIGxpbmUgPT4KICAgICAgICAgIGxpbmUudHJpbSgpLmxlbmd0aCA+IDAsCiAgICAgICk7CgogIGNvbnN0IGVudHJpZXM6CiAgICBWZXJpZmllZEZvcndhcmRPb3NQcm92ZW5hbmNlTGVkZ2VyRW50cnlWMVtdID0KICAgICAgW107CgogIGxldCBpbnZhbGlkTGluZUNvdW50ID0gMDsKICBsZXQgY2hhaW5WYWxpZCA9IHRydWU7CiAgbGV0IHByZXZpb3VzSGFzaDoKICAgIHN0cmluZyB8IG51bGwgPSBudWxsOwoKICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHsKICAgIGxldCBwYXJzZWQ6IHVua25vd24gPSBudWxsOwoKICAgIHRyeSB7CiAgICAgIHBhcnNlZCA9IEpTT04ucGFyc2UobGluZSk7CiAgICB9CiAgICBjYXRjaCB7CiAgICAgIGludmFsaWRMaW5lQ291bnQgKz0gMTsKICAgICAgY2hhaW5WYWxpZCA9IGZhbHNlOwogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBjb25zdCBlbnRyeSA9IHBhcnNlRW50cnkocGFyc2VkKTsKCiAgICBpZiAoIWVudHJ5KSB7CiAgICAgIGludmFsaWRMaW5lQ291bnQgKz0gMTsKICAgICAgY2hhaW5WYWxpZCA9IGZhbHNlOwogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBpZiAoCiAgICAgIGVudHJ5LnByZXZpb3VzRW50cnlIYXNoICE9PQogICAgICBwcmV2aW91c0hhc2gKICAgICkgewogICAgICBjaGFpblZhbGlkID0gZmFsc2U7CiAgICB9CgogICAgY29uc3QgY29yZSA9IHsKICAgICAgc2NoZW1hVmVyc2lvbjoKICAgICAgICBlbnRyeS5zY2hlbWFWZXJzaW9uLAogICAgICB2ZXJpZmllZEF0OgogICAgICAgIGVudHJ5LnZlcmlmaWVkQXQsCiAgICAgIHJ1bklkOgogICAgICAgIGVudHJ5LnJ1bklkLAogICAgICBtb2RlOgogICAgICAgIGVudHJ5Lm1vZGUsCiAgICAgIGV2aWRlbmNlU3RhdHVzOgogICAgICAgIGVudHJ5LmV2aWRlbmNlU3RhdHVzLAogICAgICBldmlkZW5jZUZpbGU6CiAgICAgICAgZW50cnkuZXZpZGVuY2VGaWxlLAogICAgICBzZXNzaW9uRmlsZToKICAgICAgICBlbnRyeS5zZXNzaW9uRmlsZSwKICAgICAgYmVmb3JlSGFzaDoKICAgICAgICBlbnRyeS5iZWZvcmVIYXNoLAogICAgICBhZnRlckhhc2g6CiAgICAgICAgZW50cnkuYWZ0ZXJIYXNoLAogICAgICBzZXNzaW9uRGVsdGE6CiAgICAgICAgZW50cnkuc2Vzc2lvbkRlbHRhLAogICAgICBzZXNzaW9uczoKICAgICAgICBlbnRyeS5zZXNzaW9ucywKICAgICAgcHJldmlvdXNFbnRyeUhhc2g6CiAgICAgICAgZW50cnkucHJldmlvdXNFbnRyeUhhc2gsCiAgICB9OwoKICAgIGlmICgKICAgICAgc2hhMjU2KGNvcmUpICE9PQogICAgICBlbnRyeS5lbnRyeUhhc2gKICAgICkgewogICAgICBjaGFpblZhbGlkID0gZmFsc2U7CiAgICB9CgogICAgZW50cmllcy5wdXNoKGVudHJ5KTsKICAgIHByZXZpb3VzSGFzaCA9CiAgICAgIGVudHJ5LmVudHJ5SGFzaDsKICB9CgogIGNvbnN0IHNlZW4gPQogICAgbmV3IFNldDxzdHJpbmc+KCk7CiAgY29uc3QgZHVwbGljYXRlUnVuSWRzOgogICAgc3RyaW5nW10gPSBbXTsKCiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7CiAgICBpZiAoc2Vlbi5oYXMoZW50cnkucnVuSWQpKSB7CiAgICAgIGR1cGxpY2F0ZVJ1bklkcy5wdXNoKAogICAgICAgIGVudHJ5LnJ1bklkLAogICAgICApOwogICAgfQoKICAgIHNlZW4uYWRkKGVudHJ5LnJ1bklkKTsKICB9CgogIGNvbnN0IHVuaXF1ZUR1cGxpY2F0ZXMgPQogICAgWy4uLm5ldyBTZXQoZHVwbGljYXRlUnVuSWRzKV07CgogIHJldHVybiB7CiAgICBleGlzdHM6IHRydWUsCiAgICBmaWxlOgogICAgICBWRVJJRklFRF9GT1JXQVJEX09PU19QUk9WRU5BTkNFX0xFREdFUl9WMSwKICAgIGVudHJpZXMsCiAgICBpbnZhbGlkTGluZUNvdW50LAogICAgY2hhaW5WYWxpZCwKICAgIGR1cGxpY2F0ZVJ1bklkczoKICAgICAgdW5pcXVlRHVwbGljYXRlcywKICAgIHZhbGlkOgogICAgICBpbnZhbGlkTGluZUNvdW50ID09PSAwICYmCiAgICAgIGNoYWluVmFsaWQgJiYKICAgICAgdW5pcXVlRHVwbGljYXRlcy5sZW5ndGggPT09IDAsCiAgfTsKfQoKZXhwb3J0IGZ1bmN0aW9uIHZlcmlmeUZvcndhcmRPb3NTZXNzaW9uQWdhaW5zdExlZGdlclYxKAogIHNlc3Npb246IHVua25vd24sCiAgbGVkZ2VyID0KICAgIHJlYWRWZXJpZmllZEZvcndhcmRPb3NQcm92ZW5hbmNlTGVkZ2VyVjEoKSwKKSB7CiAgY29uc3Qgcm93ID0gYXNSZWNvcmQoc2Vzc2lvbik7CiAgY29uc3Qgc2Vzc2lvbktleSA9CiAgICBmb3J3YXJkT29zU2Vzc2lvblByb3ZlbmFuY2VLZXlWMSgKICAgICAgc2Vzc2lvbiwKICAgICk7CgogIGlmICghcm93KSB7CiAgICByZXR1cm4gewogICAgICB2YWxpZDogZmFsc2UsCiAgICAgIHJlYXNvbjoKICAgICAgICAiU0VTU0lPTl9OT1RfT0JKRUNUIiwKICAgICAgcnVuSWQ6IG51bGwgYXMgc3RyaW5nIHwgbnVsbCwKICAgICAgc2Vzc2lvbktleSwKICAgIH07CiAgfQoKICBpZiAoIWxlZGdlci52YWxpZCkgewogICAgcmV0dXJuIHsKICAgICAgdmFsaWQ6IGZhbHNlLAogICAgICByZWFzb246CiAgICAgICAgIkxFREdFUl9JTlRFR1JJVFlfSU5WQUxJRCIsCiAgICAgIHJ1bklkOiBudWxsIGFzIHN0cmluZyB8IG51bGwsCiAgICAgIHNlc3Npb25LZXksCiAgICB9OwogIH0KCiAgY29uc3QgcHJvdmVuYW5jZSA9CiAgICBhc1JlY29yZChyb3cucHJvdmVuYW5jZSk7CiAgY29uc3QgaW50ZWdyaXR5ID0KICAgIGFzUmVjb3JkKHJvdy5pbnRlZ3JpdHkpOwoKICBjb25zdCBtb2RlID0KICAgIHRleHQocHJvdmVuYW5jZT8ubW9kZSk7CiAgY29uc3QgcnVuSWQgPQogICAgdGV4dChwcm92ZW5hbmNlPy5ydW5JZCk7CiAgY29uc3QgY2FuZGlkYXRlRmluZ2VycHJpbnQgPQogICAgdGV4dChyb3cuY2FuZGlkYXRlRmluZ2VycHJpbnQpOwogIGNvbnN0IGludGVncml0eUFsZ29yaXRobSA9CiAgICB0ZXh0KGludGVncml0eT8uYWxnb3JpdGhtKTsKICBjb25zdCBpbnRlZ3JpdHlQYXlsb2FkSGFzaCA9CiAgICB0ZXh0KGludGVncml0eT8ucGF5bG9hZEhhc2gpOwoKICBpZiAobW9kZSAhPT0gIkNPTlRST0xMRURfTk9STUFMIikgewogICAgcmV0dXJuIHsKICAgICAgdmFsaWQ6IGZhbHNlLAogICAgICByZWFzb246CiAgICAgICAgIlNFU1NJT05fTU9ERV9OT1RfQ09OVFJPTExFRF9OT1JNQUwiLAogICAgICBydW5JZCwKICAgICAgc2Vzc2lvbktleSwKICAgIH07CiAgfQoKICBpZiAoIXJ1bklkKSB7CiAgICByZXR1cm4gewogICAgICB2YWxpZDogZmFsc2UsCiAgICAgIHJlYXNvbjoKICAgICAgICAiU0VTU0lPTl9SVU5fSURfTUlTU0lORyIsCiAgICAgIHJ1bklkLAogICAgICBzZXNzaW9uS2V5LAogICAgfTsKICB9CgogIGlmICghaXNTaGEyNTYoY2FuZGlkYXRlRmluZ2VycHJpbnQpKSB7CiAgICByZXR1cm4gewogICAgICB2YWxpZDogZmFsc2UsCiAgICAgIHJlYXNvbjoKICAgICAgICAiU0VTU0lPTl9DQU5ESURBVEVfRklOR0VSUFJJTlRfSU5WQUxJRCIsCiAgICAgIHJ1bklkLAogICAgICBzZXNzaW9uS2V5LAogICAgfTsKICB9CgogIGlmICgKICAgIGludGVncml0eUFsZ29yaXRobSAhPT0gInNoYTI1NiIgfHwKICAgICFpc1NoYTI1NihpbnRlZ3JpdHlQYXlsb2FkSGFzaCkKICApIHsKICAgIHJldHVybiB7CiAgICAgIHZhbGlkOiBmYWxzZSwKICAgICAgcmVhc29uOgogICAgICAgICJTRVNTSU9OX0lOVEVHUklUWV9JTlZBTElEIiwKICAgICAgcnVuSWQsCiAgICAgIHNlc3Npb25LZXksCiAgICB9OwogIH0KCiAgY29uc3QgbGVkZ2VyRW50cnkgPQogICAgbGVkZ2VyLmVudHJpZXMuZmluZCgKICAgICAgZW50cnkgPT4KICAgICAgICBlbnRyeS5ydW5JZCA9PT0gcnVuSWQsCiAgICApOwoKICBpZiAoIWxlZGdlckVudHJ5KSB7CiAgICByZXR1cm4gewogICAgICB2YWxpZDogZmFsc2UsCiAgICAgIHJlYXNvbjoKICAgICAgICAiUlVOX0lEX05PVF9WRVJJRklFRF9JTl9MRURHRVIiLAogICAgICBydW5JZCwKICAgICAgc2Vzc2lvbktleSwKICAgIH07CiAgfQoKICBjb25zdCBhdHRlc3RhdGlvbiA9CiAgICBsZWRnZXJFbnRyeS5zZXNzaW9ucy5maW5kKAogICAgICBpdGVtID0+CiAgICAgICAgaXRlbS5zZXNzaW9uS2V5ID09PQogICAgICAgIHNlc3Npb25LZXksCiAgICApOwoKICBpZiAoIWF0dGVzdGF0aW9uKSB7CiAgICByZXR1cm4gewogICAgICB2YWxpZDogZmFsc2UsCiAgICAgIHJlYXNvbjoKICAgICAgICAiU0VTU0lPTl9LRVlfTk9UX0FUVEVTVEVEX0lOX0xFREdFUiIsCiAgICAgIHJ1bklkLAogICAgICBzZXNzaW9uS2V5LAogICAgfTsKICB9CgogIGlmICgKICAgIGF0dGVzdGF0aW9uLmNhbmRpZGF0ZUZpbmdlcnByaW50ICE9PQogICAgICBjYW5kaWRhdGVGaW5nZXJwcmludCB8fAogICAgYXR0ZXN0YXRpb24uaW50ZWdyaXR5UGF5bG9hZEhhc2ggIT09CiAgICAgIGludGVncml0eVBheWxvYWRIYXNoCiAgKSB7CiAgICByZXR1cm4gewogICAgICB2YWxpZDogZmFsc2UsCiAgICAgIHJlYXNvbjoKICAgICAgICAiU0VTU0lPTl9BVFRFU1RBVElPTl9NSVNNQVRDSCIsCiAgICAgIHJ1bklkLAogICAgICBzZXNzaW9uS2V5LAogICAgfTsKICB9CgogIHJldHVybiB7CiAgICB2YWxpZDogdHJ1ZSwKICAgIHJlYXNvbjoKICAgICAgIlZFUklGSUVEX0NPTlRST0xMRURfRk9SV0FSRF9TRVNTSU9OIiwKICAgIHJ1bklkLAogICAgc2Vzc2lvbktleSwKICB9Owp9CgpleHBvcnQgZnVuY3Rpb24gYXBwZW5kVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlclYxKAogIGlucHV0OiB7CiAgICB2ZXJpZmllZEF0OiBzdHJpbmc7CiAgICBydW5JZDogc3RyaW5nOwogICAgZXZpZGVuY2VTdGF0dXM6IHN0cmluZzsKICAgIGV2aWRlbmNlRmlsZTogc3RyaW5nOwogICAgc2Vzc2lvbkZpbGU6IHN0cmluZyB8IG51bGw7CiAgICBiZWZvcmVIYXNoOiBzdHJpbmcgfCBudWxsOwogICAgYWZ0ZXJIYXNoOiBzdHJpbmcgfCBudWxsOwogICAgc2Vzc2lvbkRlbHRhOiBudW1iZXI7CiAgICBzZXNzaW9uczogdW5rbm93bltdOwogIH0sCiAgcm9vdCA9IHByb2Nlc3MuY3dkKCksCikgewogIGNvbnN0IGxlZGdlciA9CiAgICByZWFkVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlclYxKAogICAgICByb290LAogICAgKTsKCiAgaWYgKCFsZWRnZXIudmFsaWQpIHsKICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgIlZFUklGSUVEX1BST1ZFTkFOQ0VfTEVER0VSX0lOVEVHUklUWV9JTlZBTElEIiwKICAgICk7CiAgfQoKICBjb25zdCBleGlzdGluZyA9CiAgICBsZWRnZXIuZW50cmllcy5maW5kKAogICAgICBlbnRyeSA9PgogICAgICAgIGVudHJ5LnJ1bklkID09PSBpbnB1dC5ydW5JZCwKICAgICk7CgogIGlmIChleGlzdGluZykgewogICAgcmV0dXJuIHsKICAgICAgYXBwZW5kZWQ6IGZhbHNlLAogICAgICBkdXBsaWNhdGVTdXBwcmVzc2VkOiB0cnVlLAogICAgICBlbnRyeTogZXhpc3RpbmcsCiAgICB9OwogIH0KCiAgaWYgKAogICAgIWlucHV0LnJ1bklkIHx8CiAgICBpbnB1dC5zZXNzaW9ucy5sZW5ndGggIT09IDEKICApIHsKICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgIlZFUklGSUVEX1BST1ZFTkFOQ0VfTEVER0VSX1JFUVVJUkVTX09ORV9TRVNTSU9OX0FORF9SVU5fSUQiLAogICAgKTsKICB9CgogIGNvbnN0IHNlc3Npb25zID0KICAgIGlucHV0LnNlc3Npb25zLm1hcCgKICAgICAgc2Vzc2lvbkF0dGVzdGF0aW9uLAogICAgKTsKCiAgaWYgKAogICAgc2Vzc2lvbnMuc29tZSgKICAgICAgaXRlbSA9PgogICAgICAgICFpdGVtLnNlc3Npb25LZXkgfHwKICAgICAgICAhaXNTaGEyNTYoCiAgICAgICAgICBpdGVtLmNhbmRpZGF0ZUZpbmdlcnByaW50LAogICAgICAgICkgfHwKICAgICAgICAhaXNTaGEyNTYoCiAgICAgICAgICBpdGVtLmludGVncml0eVBheWxvYWRIYXNoLAogICAgICAgICksCiAgICApCiAgKSB7CiAgICB0aHJvdyBuZXcgRXJyb3IoCiAgICAgICJWRVJJRklFRF9QUk9WRU5BTkNFX0xFREdFUl9TRVNTSU9OX0FUVEVTVEFUSU9OX0lOVkFMSUQiLAogICAgKTsKICB9CgogIGNvbnN0IHByZXZpb3VzRW50cnlIYXNoID0KICAgIGxlZGdlci5lbnRyaWVzLmxlbmd0aCA+IDAKICAgICAgPyBsZWRnZXIuZW50cmllc1sKICAgICAgICAgIGxlZGdlci5lbnRyaWVzLmxlbmd0aCAtIDEKICAgICAgICBdPy5lbnRyeUhhc2ggPz8gbnVsbAogICAgICA6IG51bGw7CgogIGNvbnN0IGNvcmUgPSB7CiAgICBzY2hlbWFWZXJzaW9uOgogICAgICBWRVJJRklFRF9GT1JXQVJEX09PU19QUk9WRU5BTkNFX0xFREdFUl9TQ0hFTUFfVjEsCiAgICB2ZXJpZmllZEF0OgogICAgICBpbnB1dC52ZXJpZmllZEF0LAogICAgcnVuSWQ6CiAgICAgIGlucHV0LnJ1bklkLAogICAgbW9kZToKICAgICAgIkNPTlRST0xMRURfTk9STUFMIiBhcyBjb25zdCwKICAgIGV2aWRlbmNlU3RhdHVzOgogICAgICBpbnB1dC5ldmlkZW5jZVN0YXR1cywKICAgIGV2aWRlbmNlRmlsZToKICAgICAgaW5wdXQuZXZpZGVuY2VGaWxlLAogICAgc2Vzc2lvbkZpbGU6CiAgICAgIGlucHV0LnNlc3Npb25GaWxlLAogICAgYmVmb3JlSGFzaDoKICAgICAgaW5wdXQuYmVmb3JlSGFzaCwKICAgIGFmdGVySGFzaDoKICAgICAgaW5wdXQuYWZ0ZXJIYXNoLAogICAgc2Vzc2lvbkRlbHRhOgogICAgICBpbnB1dC5zZXNzaW9uRGVsdGEsCiAgICBzZXNzaW9ucywKICAgIHByZXZpb3VzRW50cnlIYXNoLAogIH07CgogIGNvbnN0IGVudHJ5OgogICAgVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlckVudHJ5VjEgPQogICAgICB7CiAgICAgICAgLi4uY29yZSwKICAgICAgICBlbnRyeUhhc2g6CiAgICAgICAgICBzaGEyNTYoY29yZSksCiAgICAgIH07CgogIGNvbnN0IGFic29sdXRlID0KICAgIHBhdGguam9pbigKICAgICAgcm9vdCwKICAgICAgVkVSSUZJRURfRk9SV0FSRF9PT1NfUFJPVkVOQU5DRV9MRURHRVJfVjEsCiAgICApOwoKICBmcy5ta2RpclN5bmMoCiAgICBwYXRoLmRpcm5hbWUoYWJzb2x1dGUpLAogICAgewogICAgICByZWN1cnNpdmU6IHRydWUsCiAgICB9LAogICk7CgogIGZzLmFwcGVuZEZpbGVTeW5jKAogICAgYWJzb2x1dGUsCiAgICBKU09OLnN0cmluZ2lmeShlbnRyeSkgKyAiXG4iLAogICAgInV0ZjgiLAogICk7CgogIHJldHVybiB7CiAgICBhcHBlbmRlZDogdHJ1ZSwKICAgIGR1cGxpY2F0ZVN1cHByZXNzZWQ6IGZhbHNlLAogICAgZW50cnksCiAgfTsKfQo=",
      "base64"
    ).toString("utf8"),
    "utf8"
  );

  if (
    !evidence.includes(
      "appendVerifiedForwardOosProvenanceLedgerV1"
    )
  ) {
    evidence =
      replaceOnce(
        evidence,
        'import crypto from "node:crypto";',
        'import crypto from "node:crypto";\n\nimport {\n  appendVerifiedForwardOosProvenanceLedgerV1,\n} from "../lib/research/forward-oos-verified-provenance-ledger-v1";',
        "EVIDENCE_IMPORT"
      );
  }

  if (
    !evidence.includes(
      "verifiedLedgerAppend"
    )
  ) {
    evidence =
      replaceOnce(
        evidence,
        `  fs.writeFileSync(
    path.join(
      logsDir,
      "true-forward-oos-controlled-producer-evidence-run-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  return report;`,
        `  fs.writeFileSync(
    path.join(
      logsDir,
      "true-forward-oos-controlled-producer-evidence-run-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  const verifiedLedgerAppend =
    !dryRun &&
    failed.length === 0 &&
    Boolean(evidenceRunId) &&
    newSessions.length === 1
      ? appendVerifiedForwardOosProvenanceLedgerV1({
          verifiedAt:
            (
              input.now ??
              new Date()
            ).toISOString(),

          runId:
            evidenceRunId as string,

          evidenceStatus:
            report.status,

          evidenceFile:
            "logs/true-forward-oos-controlled-producer-evidence-run-v1.json",

          sessionFile:
            after.file,

          beforeHash:
            before.hash,

          afterHash:
            after.hash,

          sessionDelta:
            newSessions.length,

          sessions:
            newSessions,
        })
      : null;

  void verifiedLedgerAppend;

  return report;`,
        "EVIDENCE_LEDGER_APPEND"
      );
  }

  if (
    !dashboard.includes(
      "verifyForwardOosSessionAgainstLedgerV1"
    )
  ) {
    const anchor =
      `import {
  nextKrxTradingDate,
} from "../trading/krx-trading-calendar";`;

    dashboard =
      replaceOnce(
        dashboard,
        anchor,
        anchor +
        `

import {
  readVerifiedForwardOosProvenanceLedgerV1,
  verifyForwardOosSessionAgainstLedgerV1,
} from "./forward-oos-verified-provenance-ledger-v1";`,
        "DASHBOARD_IMPORT"
      );
  }

  if (
    dashboard.indexOf(
      "input.invalidCount >"
    ) >
    dashboard.indexOf(
      "input.sessionCount ==="
    )
  ) {
    const waitBlock =
      `  if (
    input.sessionCount ===
    0
  ) {
    return {
      currentGate:
        "WAITING_FOR_FORWARD_SESSION",

      nextAction:
        "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION",
    };
  }

`;

    const invalidBlock =
      `  if (
    input.invalidCount >
    0
  ) {
    return {
      currentGate:
        "FORWARD_SESSION_INTEGRITY_FAILED",

      nextAction:
        "REPAIR_FORWARD_SESSION_INTEGRITY",
    };
  }

`;

    dashboard =
      replaceOnce(
        dashboard,
        waitBlock +
        invalidBlock,
        invalidBlock +
        waitBlock,
        "DASHBOARD_GATE_ORDER"
      );
  }

  if (
    !dashboard.includes(
      "provenanceBlockedCount"
    )
  ) {
    dashboard =
      replaceOnce(
        dashboard,
        `  const sessions =
    arrayOf(
      forward?.sessions,
    );`,
        `  const rawSessions =
    arrayOf(
      forward?.sessions,
    );

  const provenanceLedger =
    readVerifiedForwardOosProvenanceLedgerV1();

  const provenanceVerification =
    rawSessions.map(
      session =>
        verifyForwardOosSessionAgainstLedgerV1(
          session,
          provenanceLedger,
        ),
    );

  const sessions =
    rawSessions.filter(
      (
        _session,
        index,
      ) =>
        provenanceVerification[index]
          ?.valid === true,
    );

  const provenanceBlockedCount =
    rawSessions.length -
    sessions.length;

  const ledgerIntegrityFailed =
    provenanceLedger.exists &&
    !provenanceLedger.valid;`,
        "DASHBOARD_SESSION_FILTER"
      );
  }

  if (
    !dashboard.includes(
      "const gateInvalidCount ="
    )
  ) {
    dashboard =
      replaceOnce(
        dashboard,
        `  const invalid =
    sessions.length -
    valid.length;`,
        `  const invalid =
    sessions.length -
    valid.length;

  const gateInvalidCount =
    invalid +
    provenanceBlockedCount +
    (
      ledgerIntegrityFailed
        ? 1
        : 0
    );`,
        "DASHBOARD_INVALID_COUNT"
      );
  }

  dashboard =
    dashboard.replace(
      `      invalidCount:
        invalid,`,
      `      invalidCount:
        gateInvalidCount,`
    );

  if (
    !dashboard.includes(
      "canonical Forward session(s) failed verified provenance ledger checks"
    )
  ) {
    dashboard =
      replaceOnce(
        dashboard,
        `  if (
    invalid >
    0
  ) {
    warnings.push(
      \`\${invalid} Forward session(s) failed integrity checks.\`,
    );
  }
`,
        `  if (
    invalid >
    0
  ) {
    warnings.push(
      \`\${invalid} Forward session(s) failed integrity checks.\`,
    );
  }

  if (
    provenanceBlockedCount >
    0
  ) {
    warnings.push(
      \`\${provenanceBlockedCount} canonical Forward session(s) failed verified provenance ledger checks and were excluded from evidence counts.\`,
    );
  }

  if (
    ledgerIntegrityFailed
  ) {
    warnings.push(
      "Verified Forward provenance ledger integrity is invalid; evidence counting is blocked.",
    );
  }
`,
        "DASHBOARD_WARNINGS"
      );
  }

  if (
    !monitor.includes(
      "verifyForwardOosSessionAgainstLedgerV1"
    )
  ) {
    const anchor =
      `import {
  isKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";`;

    monitor =
      replaceOnce(
        monitor,
        anchor,
        anchor +
        `

import {
  readVerifiedForwardOosProvenanceLedgerV1,
  verifyForwardOosSessionAgainstLedgerV1,
} from "../lib/research/forward-oos-verified-provenance-ledger-v1";`,
        "MONITOR_IMPORT"
      );
  }

  if (
    !monitor.includes(
      "const provenanceIssues ="
    )
  ) {
    monitor =
      replaceOnce(
        monitor,
        `  const normalizedObservations =
    observations
      .map(
        raw =>
          asRecord(raw),
      )
      .filter(
        (
          row,
        ): row is JsonRecord =>
          Boolean(row),
      );`,
        `  const normalizedObservations =
    observations
      .map(
        raw =>
          asRecord(raw),
      )
      .filter(
        (
          row,
        ): row is JsonRecord =>
          Boolean(row),
      );

  const provenanceLedger =
    readVerifiedForwardOosProvenanceLedgerV1();

  const provenanceVerification =
    normalizedSessions.map(
      row =>
        verifyForwardOosSessionAgainstLedgerV1(
          row,
          provenanceLedger,
        ),
    );

  const verifiedSessions =
    normalizedSessions.filter(
      (
        _row,
        index,
      ) =>
        provenanceVerification[index]
          ?.valid === true,
    );

  const provenanceIssues =
    provenanceVerification
      .filter(
        result =>
          result.valid !== true,
      )
      .map(
        result => ({
          sessionKey:
            result.sessionKey,
          runId:
            result.runId,
          reason:
            result.reason,
        }),
      );

  const ledgerIntegrityIssues =
    provenanceLedger.exists &&
    !provenanceLedger.valid
      ? [
          {
            reason:
              "VERIFIED_PROVENANCE_LEDGER_INTEGRITY_INVALID",
            invalidLineCount:
              provenanceLedger.invalidLineCount,
            chainValid:
              provenanceLedger.chainValid,
            duplicateRunIds:
              provenanceLedger.duplicateRunIds,
          },
        ]
      : [];`,
        "MONITOR_SESSION_FILTER"
      );
  }

  monitor =
    monitor.replace(
      `  const hasControlledSession =
    normalizedSessions.length >
    0;`,
      `  const hasControlledSession =
    verifiedSessions.length >
    0;`
    );

  if (
    !monitor.includes(
      "    provenanceIssues,"
    )
  ) {
    monitor =
      replaceOnce(
        monitor,
        `    summaryCountMismatch,
  };`,
        `    summaryCountMismatch,
    provenanceIssues,
    ledgerIntegrityIssues,
  };`,
        "MONITOR_HARD_ISSUES"
      );
  }

  const oldStatusOrder =
    `  if (
    !hasControlledSession
  ) {
    status =
      "AI_STOCK_LAB_FORWARD_OOS_DATA_QUALITY_INTEGRITY_V1_WAITING_FOR_FIRST_CONTROLLED_SESSION";

    nextAction =
      "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION";
  }
  else if (
    hardIssueCount >
    0
  ) {
    status =
      "AI_STOCK_LAB_FORWARD_OOS_DATA_QUALITY_INTEGRITY_V1_BLOCKED";

    nextAction =
      "REPAIR_FORWARD_OOS_DATA_QUALITY_BEFORE_COUNTING_EVIDENCE";
  }`;

  const newStatusOrder =
    `  if (
    hardIssueCount >
    0
  ) {
    status =
      "AI_STOCK_LAB_FORWARD_OOS_DATA_QUALITY_INTEGRITY_V1_BLOCKED";

    nextAction =
      "REPAIR_FORWARD_OOS_DATA_QUALITY_BEFORE_COUNTING_EVIDENCE";
  }
  else if (
    !hasControlledSession
  ) {
    status =
      "AI_STOCK_LAB_FORWARD_OOS_DATA_QUALITY_INTEGRITY_V1_WAITING_FOR_FIRST_CONTROLLED_SESSION";

    nextAction =
      "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION";
  }`;

  if (
    monitor.includes(
      oldStatusOrder
    )
  ) {
    monitor =
      monitor.replace(
        oldStatusOrder,
        newStatusOrder
      );
  }

  if (
    !monitor.includes(
      "rawCanonicalSessions:"
    )
  ) {
    monitor =
      replaceOnce(
        monitor,
        `      sessions:
        normalizedSessions.length,

      observations:`,
        `      sessions:
        verifiedSessions.length,

      rawCanonicalSessions:
        normalizedSessions.length,

      provenanceBlockedSessions:
        provenanceIssues.length,

      observations:`,
        "MONITOR_COUNTS"
      );
  }

  if (
    !monitor.includes(
      "      provenanceIssues,"
    )
  ) {
    monitor =
      replaceOnce(
        monitor,
        `      summaryCountMismatch,
    },`,
        `      summaryCountMismatch,
      provenanceIssues,
      ledgerIntegrityIssues,
    },`,
        "MONITOR_REPORT_INTEGRITY"
      );
  }

  if (
    !monitor.includes(
      "allCanonicalSessionsProvenanceVerified:"
    )
  ) {
    monitor =
      replaceOnce(
        monitor,
        `      summaryCountConsistent:
        !summaryCountMismatch,
    },`,
        `      summaryCountConsistent:
        !summaryCountMismatch,

      allCanonicalSessionsProvenanceVerified:
        provenanceIssues.length === 0,

      verifiedProvenanceLedgerValid:
        provenanceLedger.valid,
    },`,
        "MONITOR_GATES"
      );
  }

  monitor =
    monitor.replace(
      `      waitIsNormal:
        !hasControlledSession,`,
      `      waitIsNormal:
        !hasControlledSession &&
        hardIssueCount === 0,`
    );

  fs.writeFileSync(
    abs(FILES.contract),
    Buffer.from(
      "aW1wb3J0IGZzIGZyb20gIm5vZGU6ZnMiOwppbXBvcnQgb3MgZnJvbSAibm9kZTpvcyI7CmltcG9ydCBwYXRoIGZyb20gIm5vZGU6cGF0aCI7CgppbXBvcnQgewogIGFwcGVuZFZlcmlmaWVkRm9yd2FyZE9vc1Byb3ZlbmFuY2VMZWRnZXJWMSwKICByZWFkVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlclYxLAogIHZlcmlmeUZvcndhcmRPb3NTZXNzaW9uQWdhaW5zdExlZGdlclYxLAogIFZFUklGSUVEX0ZPUldBUkRfT09TX1BST1ZFTkFOQ0VfTEVER0VSX1YxLAp9IGZyb20gIi4uL2xpYi9yZXNlYXJjaC9mb3J3YXJkLW9vcy12ZXJpZmllZC1wcm92ZW5hbmNlLWxlZGdlci12MSI7Cgpjb25zdCByb290ID0KICBmcy5ta2R0ZW1wU3luYygKICAgIHBhdGguam9pbigKICAgICAgb3MudG1wZGlyKCksCiAgICAgICJhaS1zdG9jay1mb3J3YXJkLWxlZGdlci12MS0iLAogICAgKSwKICApOwoKdHJ5IHsKICBjb25zdCBydW5JZCA9CiAgICAiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIjsKCiAgY29uc3Qgc2Vzc2lvbiA9IHsKICAgIHNvdXJjZVRyYWRpbmdEYXRlOgogICAgICAiMjAyNi0xMC0wOCIsCiAgICB0YXJnZXRTZXNzaW9uRGF0ZToKICAgICAgIjIwMjYtMTAtMTIiLAogICAgdG9wMTogewogICAgICBzdG9ja0NvZGU6CiAgICAgICAgIjAwNTkzMCIsCiAgICB9LAogICAgcHJvdmVuYW5jZTogewogICAgICBtb2RlOgogICAgICAgICJDT05UUk9MTEVEX05PUk1BTCIsCiAgICAgIHJ1bklkLAogICAgfSwKICAgIGNhbmRpZGF0ZUZpbmdlcnByaW50OgogICAgICAiYSIucmVwZWF0KDY0KSwKICAgIGludGVncml0eTogewogICAgICBhbGdvcml0aG06CiAgICAgICAgInNoYTI1NiIsCiAgICAgIHBheWxvYWRIYXNoOgogICAgICAgICJiIi5yZXBlYXQoNjQpLAogICAgfSwKICB9OwoKICBjb25zdCBmaXJzdCA9CiAgICBhcHBlbmRWZXJpZmllZEZvcndhcmRPb3NQcm92ZW5hbmNlTGVkZ2VyVjEoCiAgICAgIHsKICAgICAgICB2ZXJpZmllZEF0OgogICAgICAgICAgIjIwMjYtMTAtMTJUMDA6MDA6MDAuMDAwWiIsCiAgICAgICAgcnVuSWQsCiAgICAgICAgZXZpZGVuY2VTdGF0dXM6CiAgICAgICAgICAiQUlfU1RPQ0tfTEFCX1RSVUVfRk9SV0FSRF9PT1NfQ09OVFJPTExFRF9QUk9EVUNFUl9FVklERU5DRV9SVU5fVjFfVkVSSUZJRUQiLAogICAgICAgIGV2aWRlbmNlRmlsZToKICAgICAgICAgICJsb2dzL3RydWUtZm9yd2FyZC1vb3MtY29udHJvbGxlZC1wcm9kdWNlci1ldmlkZW5jZS1ydW4tdjEuanNvbiIsCiAgICAgICAgc2Vzc2lvbkZpbGU6CiAgICAgICAgICAibG9ncy9hbHBoYS12My10cnVlLWZvcndhcmQtdG9wMS1zZXNzaW9ucy12MS5qc29uIiwKICAgICAgICBiZWZvcmVIYXNoOgogICAgICAgICAgbnVsbCwKICAgICAgICBhZnRlckhhc2g6CiAgICAgICAgICAiYyIucmVwZWF0KDY0KSwKICAgICAgICBzZXNzaW9uRGVsdGE6CiAgICAgICAgICAxLAogICAgICAgIHNlc3Npb25zOiBbCiAgICAgICAgICBzZXNzaW9uLAogICAgICAgIF0sCiAgICAgIH0sCiAgICAgIHJvb3QsCiAgICApOwoKICBjb25zdCBsZWRnZXIgPQogICAgcmVhZFZlcmlmaWVkRm9yd2FyZE9vc1Byb3ZlbmFuY2VMZWRnZXJWMSgKICAgICAgcm9vdCwKICAgICk7CgogIGNvbnN0IHZlcmlmaWVkID0KICAgIHZlcmlmeUZvcndhcmRPb3NTZXNzaW9uQWdhaW5zdExlZGdlclYxKAogICAgICBzZXNzaW9uLAogICAgICBsZWRnZXIsCiAgICApOwoKICBjb25zdCBkdXBsaWNhdGUgPQogICAgYXBwZW5kVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlclYxKAogICAgICB7CiAgICAgICAgdmVyaWZpZWRBdDoKICAgICAgICAgICIyMDI2LTEwLTEyVDAwOjAwOjAwLjAwMFoiLAogICAgICAgIHJ1bklkLAogICAgICAgIGV2aWRlbmNlU3RhdHVzOgogICAgICAgICAgIkFJX1NUT0NLX0xBQl9UUlVFX0ZPUldBUkRfT09TX0NPTlRST0xMRURfUFJPRFVDRVJfRVZJREVOQ0VfUlVOX1YxX1ZFUklGSUVEIiwKICAgICAgICBldmlkZW5jZUZpbGU6CiAgICAgICAgICAibG9ncy90cnVlLWZvcndhcmQtb29zLWNvbnRyb2xsZWQtcHJvZHVjZXItZXZpZGVuY2UtcnVuLXYxLmpzb24iLAogICAgICAgIHNlc3Npb25GaWxlOgogICAgICAgICAgImxvZ3MvYWxwaGEtdjMtdHJ1ZS1mb3J3YXJkLXRvcDEtc2Vzc2lvbnMtdjEuanNvbiIsCiAgICAgICAgYmVmb3JlSGFzaDoKICAgICAgICAgIG51bGwsCiAgICAgICAgYWZ0ZXJIYXNoOgogICAgICAgICAgImMiLnJlcGVhdCg2NCksCiAgICAgICAgc2Vzc2lvbkRlbHRhOgogICAgICAgICAgMSwKICAgICAgICBzZXNzaW9uczogWwogICAgICAgICAgc2Vzc2lvbiwKICAgICAgICBdLAogICAgICB9LAogICAgICByb290LAogICAgKTsKCiAgY29uc3QgdGFtcGVyZWRTZXNzaW9uID0gewogICAgLi4uc2Vzc2lvbiwKICAgIGNhbmRpZGF0ZUZpbmdlcnByaW50OgogICAgICAiZCIucmVwZWF0KDY0KSwKICB9OwoKICBjb25zdCB0YW1wZXJlZFNlc3Npb25SZXN1bHQgPQogICAgdmVyaWZ5Rm9yd2FyZE9vc1Nlc3Npb25BZ2FpbnN0TGVkZ2VyVjEoCiAgICAgIHRhbXBlcmVkU2Vzc2lvbiwKICAgICAgbGVkZ2VyLAogICAgKTsKCiAgY29uc3QgbGVkZ2VyRmlsZSA9CiAgICBwYXRoLmpvaW4oCiAgICAgIHJvb3QsCiAgICAgIFZFUklGSUVEX0ZPUldBUkRfT09TX1BST1ZFTkFOQ0VfTEVER0VSX1YxLAogICAgKTsKCiAgY29uc3Qgb3JpZ2luYWwgPQogICAgZnMucmVhZEZpbGVTeW5jKAogICAgICBsZWRnZXJGaWxlLAogICAgICAidXRmOCIsCiAgICApOwoKICBmcy53cml0ZUZpbGVTeW5jKAogICAgbGVkZ2VyRmlsZSwKICAgIG9yaWdpbmFsLnJlcGxhY2UoCiAgICAgICcic2Vzc2lvbkRlbHRhIjoxJywKICAgICAgJyJzZXNzaW9uRGVsdGEiOjInLAogICAgKSwKICAgICJ1dGY4IiwKICApOwoKICBjb25zdCB0YW1wZXJlZExlZGdlciA9CiAgICByZWFkVmVyaWZpZWRGb3J3YXJkT29zUHJvdmVuYW5jZUxlZGdlclYxKAogICAgICByb290LAogICAgKTsKCiAgY29uc3QgY2hlY2tzID0gewogICAgZmlyc3RBcHBlbmQ6CiAgICAgIGZpcnN0LmFwcGVuZGVkID09PSB0cnVlLAogICAgbGVkZ2VyVmFsaWQ6CiAgICAgIGxlZGdlci52YWxpZCA9PT0gdHJ1ZSwKICAgIG9uZUVudHJ5OgogICAgICBsZWRnZXIuZW50cmllcy5sZW5ndGggPT09IDEsCiAgICB2ZXJpZmllZFNlc3Npb25BY2NlcHRlZDoKICAgICAgdmVyaWZpZWQudmFsaWQgPT09IHRydWUsCiAgICBkdXBsaWNhdGVSdW5TdXBwcmVzc2VkOgogICAgICBkdXBsaWNhdGUuYXBwZW5kZWQgPT09IGZhbHNlICYmCiAgICAgIGR1cGxpY2F0ZS5kdXBsaWNhdGVTdXBwcmVzc2VkID09PSB0cnVlLAogICAgdGFtcGVyZWRTZXNzaW9uUmVqZWN0ZWQ6CiAgICAgIHRhbXBlcmVkU2Vzc2lvblJlc3VsdC52YWxpZCA9PT0gZmFsc2UsCiAgICB0YW1wZXJlZExlZGdlclJlamVjdGVkOgogICAgICB0YW1wZXJlZExlZGdlci52YWxpZCA9PT0gZmFsc2UgJiYKICAgICAgdGFtcGVyZWRMZWRnZXIuY2hhaW5WYWxpZCA9PT0gZmFsc2UsCiAgfTsKCiAgY29uc3QgZmFpbGVkID0KICAgIE9iamVjdC5lbnRyaWVzKGNoZWNrcykKICAgICAgLmZpbHRlcigKICAgICAgICAoWywgdmFsdWVdKSA9PgogICAgICAgICAgdmFsdWUgIT09IHRydWUsCiAgICAgICkKICAgICAgLm1hcCgKICAgICAgICAoW2tleV0pID0+CiAgICAgICAgICBrZXksCiAgICAgICk7CgogIGNvbnNvbGUubG9nKAogICAgSlNPTi5zdHJpbmdpZnkoCiAgICAgIHsKICAgICAgICBzdGF0dXM6CiAgICAgICAgICBmYWlsZWQubGVuZ3RoID09PSAwCiAgICAgICAgICAgID8gIkFJX1NUT0NLX0xBQl9GT1JXQVJEX09PU19WRVJJRklFRF9QUk9WRU5BTkNFX0xFREdFUl9WMV9DT05UUkFDVF9WRVJJRklFRCIKICAgICAgICAgICAgOiAiQUlfU1RPQ0tfTEFCX0ZPUldBUkRfT09TX1ZFUklGSUVEX1BST1ZFTkFOQ0VfTEVER0VSX1YxX0NPTlRSQUNUX0ZBSUxFRCIsCiAgICAgICAgY2hlY2tzLAogICAgICAgIHNhZmV0eTogewogICAgICAgICAgdGVtcE9ubHk6IHRydWUsCiAgICAgICAgICBwcm9qZWN0TG9nc1dyaXR0ZW46IDAsCiAgICAgICAgICBkYXRhYmFzZVdyaXRlczogMCwKICAgICAgICAgIG9yZGVyc0NyZWF0ZWQ6IDAsCiAgICAgICAgICBwb3NpdGlvbnNDaGFuZ2VkOiAwLAogICAgICAgICAgcHJvbW90aW9uRXhlY3V0ZWQ6IGZhbHNlLAogICAgICAgICAgcmVhbFRyYWRpbmdFbmFibGVkOiBmYWxzZSwKICAgICAgICB9LAogICAgICAgIGZhaWxlZCwKICAgICAgICBuZXh0R2F0ZToKICAgICAgICAgIGZhaWxlZC5sZW5ndGggPT09IDAKICAgICAgICAgICAgPyAiUlVOX1NUQVRJQ19QSVBFTElORV9EQVNIQk9BUkRfSU5URUdSSVRZX0FQUF9UU0NfQlVJTEQiCiAgICAgICAgICAgIDogIlJFUEFJUl9WRVJJRklFRF9QUk9WRU5BTkNFX0xFREdFUl9DT05UUkFDVCIsCiAgICAgIH0sCiAgICAgIG51bGwsCiAgICAgIDIsCiAgICApLAogICk7CgogIHByb2Nlc3MuZXhpdENvZGUgPQogICAgZmFpbGVkLmxlbmd0aCA9PT0gMAogICAgICA/IDAKICAgICAgOiAxOwp9CmZpbmFsbHkgewogIGZzLnJtU3luYygKICAgIHJvb3QsCiAgICB7CiAgICAgIHJlY3Vyc2l2ZTogdHJ1ZSwKICAgICAgZm9yY2U6IHRydWUsCiAgICB9LAogICk7Cn0K",
      "base64"
    ).toString("utf8"),
    "utf8"
  );

  fs.writeFileSync(
    abs(FILES.static),
    Buffer.from(
      "Y29uc3QgZnMgPSByZXF1aXJlKCJmcyIpOwpjb25zdCBwYXRoID0gcmVxdWlyZSgicGF0aCIpOwoKY29uc3QgUk9PVCA9IHByb2Nlc3MuY3dkKCk7Cgpjb25zdCBmaWxlcyA9IHsKICBoZWxwZXI6CiAgICAibGliL3Jlc2VhcmNoL2ZvcndhcmQtb29zLXZlcmlmaWVkLXByb3ZlbmFuY2UtbGVkZ2VyLXYxLnRzIiwKICBldmlkZW5jZToKICAgICJzY3JpcHRzL3RydWUtZm9yd2FyZC1vb3MtY29udHJvbGxlZC1wcm9kdWNlci1ldmlkZW5jZS1ydW4tdjEudHMiLAogIGRhc2hib2FyZDoKICAgICJsaWIvcmVzZWFyY2gvZ2V0LWZvcndhcmQtb29zLW9ic2VydmFiaWxpdHktZGFzaGJvYXJkLXYxLnRzIiwKICBtb25pdG9yOgogICAgInNjcmlwdHMvZm9yd2FyZC1vb3MtZGF0YS1xdWFsaXR5LWludGVncml0eS1tb25pdG9yLXYxLnRzIiwKICBjb250cmFjdDoKICAgICJzY3JpcHRzL2ZvcndhcmQtb29zLXZlcmlmaWVkLXByb3ZlbmFuY2UtbGVkZ2VyLXYxLWNvbnRyYWN0LXRlc3QudHMiLAp9OwoKZnVuY3Rpb24gcmVhZChyZWwpIHsKICBjb25zdCBmaWxlID0KICAgIHBhdGguam9pbigKICAgICAgUk9PVCwKICAgICAgcmVsCiAgICApOwoKICByZXR1cm4gZnMuZXhpc3RzU3luYyhmaWxlKQogICAgPyBmcy5yZWFkRmlsZVN5bmMoCiAgICAgICAgZmlsZSwKICAgICAgICAidXRmOCIKICAgICAgKQogICAgOiAiIjsKfQoKY29uc3QgaGVscGVyID0gcmVhZChmaWxlcy5oZWxwZXIpOwpjb25zdCBldmlkZW5jZSA9IHJlYWQoZmlsZXMuZXZpZGVuY2UpOwpjb25zdCBkYXNoYm9hcmQgPSByZWFkKGZpbGVzLmRhc2hib2FyZCk7CmNvbnN0IG1vbml0b3IgPSByZWFkKGZpbGVzLm1vbml0b3IpOwpjb25zdCBjb250cmFjdCA9IHJlYWQoZmlsZXMuY29udHJhY3QpOwoKY29uc3QgY2hlY2tzID0gewogIGhlbHBlckV4aXN0czoKICAgIEJvb2xlYW4oaGVscGVyKSwKICBhcHBlbmRPbmx5SnNvbmw6CiAgICBoZWxwZXIuaW5jbHVkZXMoCiAgICAgICJ0cnVlLWZvcndhcmQtb29zLWNvbnRyb2xsZWQtcHJvZHVjZXItZXZpZGVuY2UtbGVkZ2VyLXYxLmpzb25sIgogICAgKSAmJgogICAgaGVscGVyLmluY2x1ZGVzKAogICAgICAiZnMuYXBwZW5kRmlsZVN5bmMoIgogICAgKSwKICBoYXNoQ2hhaW46CiAgICBoZWxwZXIuaW5jbHVkZXMoCiAgICAgICJwcmV2aW91c0VudHJ5SGFzaCIKICAgICkgJiYKICAgIGhlbHBlci5pbmNsdWRlcygKICAgICAgImVudHJ5SGFzaCIKICAgICkgJiYKICAgIGhlbHBlci5pbmNsdWRlcygKICAgICAgImNoYWluVmFsaWQiCiAgICApLAogIHNlc3Npb25BdHRlc3RhdGlvbjoKICAgIGhlbHBlci5pbmNsdWRlcygKICAgICAgIlJVTl9JRF9OT1RfVkVSSUZJRURfSU5fTEVER0VSIgogICAgKSAmJgogICAgaGVscGVyLmluY2x1ZGVzKAogICAgICAiU0VTU0lPTl9BVFRFU1RBVElPTl9NSVNNQVRDSCIKICAgICksCiAgZXZpZGVuY2VJbXBvcnRzTGVkZ2VyOgogICAgZXZpZGVuY2UuaW5jbHVkZXMoCiAgICAgICJhcHBlbmRWZXJpZmllZEZvcndhcmRPb3NQcm92ZW5hbmNlTGVkZ2VyVjEiCiAgICApLAogIGV2aWRlbmNlR3VhcmQ6CiAgICBldmlkZW5jZS5pbmNsdWRlcygKICAgICAgImZhaWxlZC5sZW5ndGggPT09IDAiCiAgICApICYmCiAgICBldmlkZW5jZS5pbmNsdWRlcygKICAgICAgIm5ld1Nlc3Npb25zLmxlbmd0aCA9PT0gMSIKICAgICkgJiYKICAgIGV2aWRlbmNlLmluY2x1ZGVzKAogICAgICAidmVyaWZpZWRMZWRnZXJBcHBlbmQiCiAgICApLAogIGRhc2hib2FyZFZlcmlmaWVkRmlsdGVyOgogICAgZGFzaGJvYXJkLmluY2x1ZGVzKAogICAgICAicmF3U2Vzc2lvbnMiCiAgICApICYmCiAgICBkYXNoYm9hcmQuaW5jbHVkZXMoCiAgICAgICJwcm92ZW5hbmNlQmxvY2tlZENvdW50IgogICAgKSAmJgogICAgZGFzaGJvYXJkLmluY2x1ZGVzKAogICAgICAiZ2F0ZUludmFsaWRDb3VudCIKICAgICksCiAgZGFzaGJvYXJkRmFpbENsb3NlZDoKICAgIGRhc2hib2FyZC5pbmRleE9mKAogICAgICAiaW5wdXQuaW52YWxpZENvdW50ID4iCiAgICApIDwKICAgIGRhc2hib2FyZC5pbmRleE9mKAogICAgICAiaW5wdXQuc2Vzc2lvbkNvdW50ID09PSIKICAgICksCiAgbW9uaXRvclZlcmlmaWVkRmlsdGVyOgogICAgbW9uaXRvci5pbmNsdWRlcygKICAgICAgInZlcmlmaWVkU2Vzc2lvbnMiCiAgICApICYmCiAgICBtb25pdG9yLmluY2x1ZGVzKAogICAgICAicHJvdmVuYW5jZUlzc3VlcyIKICAgICkgJiYKICAgIG1vbml0b3IuaW5jbHVkZXMoCiAgICAgICJsZWRnZXJJbnRlZ3JpdHlJc3N1ZXMiCiAgICApLAogIGNvbnRyYWN0RXhpc3RzOgogICAgQm9vbGVhbihjb250cmFjdCkgJiYKICAgIGNvbnRyYWN0LmluY2x1ZGVzKAogICAgICAidGFtcGVyZWRMZWRnZXJSZWplY3RlZCIKICAgICksCiAgbm9SZWFsVHJhZGluZ0VuYWJsZToKICAgICFldmlkZW5jZS5pbmNsdWRlcygKICAgICAgJ1JFQUxfVFJBRElOR19FTkFCTEVEOiAidHJ1ZSInCiAgICApICYmCiAgICAhZGFzaGJvYXJkLmluY2x1ZGVzKAogICAgICAnUkVBTF9UUkFESU5HX0VOQUJMRUQ9dHJ1ZScKICAgICkgJiYKICAgICFtb25pdG9yLmluY2x1ZGVzKAogICAgICAnUkVBTF9UUkFESU5HX0VOQUJMRUQ9dHJ1ZScKICAgICksCn07Cgpjb25zdCBmYWlsZWQgPQogIE9iamVjdC5lbnRyaWVzKGNoZWNrcykKICAgIC5maWx0ZXIoCiAgICAgIChbLCB2YWx1ZV0pID0+CiAgICAgICAgdmFsdWUgIT09IHRydWUKICAgICkKICAgIC5tYXAoCiAgICAgIChba2V5XSkgPT4KICAgICAgICBrZXkKICAgICk7Cgpjb25zb2xlLmxvZygKICBKU09OLnN0cmluZ2lmeSgKICAgIHsKICAgICAgc3RhdHVzOgogICAgICAgIGZhaWxlZC5sZW5ndGggPT09IDAKICAgICAgICAgID8gIkFJX1NUT0NLX0xBQl9GT1JXQVJEX09PU19WRVJJRklFRF9QUk9WRU5BTkNFX0xFREdFUl9WMV9TVEFUSUNfVkVSSUZJRUQiCiAgICAgICAgICA6ICJBSV9TVE9DS19MQUJfRk9SV0FSRF9PT1NfVkVSSUZJRURfUFJPVkVOQU5DRV9MRURHRVJfVjFfU1RBVElDX0ZBSUxFRCIsCiAgICAgIGNoZWNrcywKICAgICAgY29udHJhY3Q6IHsKICAgICAgICBsZWRnZXI6CiAgICAgICAgICAibG9ncy90cnVlLWZvcndhcmQtb29zLWNvbnRyb2xsZWQtcHJvZHVjZXItZXZpZGVuY2UtbGVkZ2VyLXYxLmpzb25sIiwKICAgICAgICBhcHBlbmRSdWxlOgogICAgICAgICAgIk5PUk1BTCArIEFMTCBDSEVDS1MgUEFTUyArIEVYQUNUTFkgT05FIE5FVyBTRVNTSU9OIiwKICAgICAgICBkYXNoYm9hcmRSdWxlOgogICAgICAgICAgIkNPVU5UIE9OTFkgTEVER0VSLUFUVEVTVEVEIENPTlRST0xMRURfTk9STUFMIFNFU1NJT05TIiwKICAgICAgICBpbnRlZ3JpdHlSdWxlOgogICAgICAgICAgIlVOVkVSSUZJRUQgQ0FOT05JQ0FMIFNFU1NJT04gT1IgSU5WQUxJRCBMRURHRVIgPT4gQkxPQ0tFRCIsCiAgICAgICAgd2FpdFJ1bGU6CiAgICAgICAgICAiWkVSTyBDQU5PTklDQUwgU0VTU0lPTiArIE5PIExFREdFUiA9PiBXQUlUIE5PUk1BTCIsCiAgICAgIH0sCiAgICAgIHNhZmV0eTogewogICAgICAgIHNvdXJjZU9ubHlQYXRjaDogdHJ1ZSwKICAgICAgICBwcm9kdWNlckV4ZWN1dGVkOiBmYWxzZSwKICAgICAgICBjb2xsZWN0b3JFeGVjdXRlZDogZmFsc2UsCiAgICAgICAgZGF0YWJhc2VSZWFkczogMCwKICAgICAgICBkYXRhYmFzZVdyaXRlczogMCwKICAgICAgICBvcmRlcnNDcmVhdGVkOiAwLAogICAgICAgIHBvc2l0aW9uc0NoYW5nZWQ6IDAsCiAgICAgICAgcHJvbW90aW9uRXhlY3V0ZWQ6IGZhbHNlLAogICAgICAgIHJlYWxUcmFkaW5nRW5hYmxlZDogZmFsc2UsCiAgICAgIH0sCiAgICAgIGZhaWxlZCwKICAgICAgbmV4dEdhdGU6CiAgICAgICAgZmFpbGVkLmxlbmd0aCA9PT0gMAogICAgICAgICAgPyAiUlVOX0xFREdFUl9DT05UUkFDVF9GT1JXQVJEX1BJUEVMSU5FX0RBU0hCT0FSRF9JTlRFR1JJVFlfQVBQX1RTQ19CVUlMRCIKICAgICAgICAgIDogIlJFUEFJUl9WRVJJRklFRF9QUk9WRU5BTkNFX0xFREdFUl9WMSIsCiAgICB9LAogICAgbnVsbCwKICAgIDIsCiAgKSwKKTsKCnByb2Nlc3MuZXhpdENvZGUgPQogIGZhaWxlZC5sZW5ndGggPT09IDAKICAgID8gMAogICAgOiAxOwo=",
      "base64"
    ).toString("utf8"),
    "utf8"
  );
}
catch (error) {
  fail(
    "PATCH_FAILED",
    {
      error:
        String(
          error instanceof Error
            ? error.message
            : error
        )
    }
  );
  return;
}

fs.writeFileSync(
  abs(FILES.evidence),
  evidence,
  "utf8"
);

fs.writeFileSync(
  abs(FILES.dashboard),
  dashboard,
  "utf8"
);

fs.writeFileSync(
  abs(FILES.monitor),
  monitor,
  "utf8"
);

const checks = {
  helperCreated:
    fs.existsSync(
      abs(FILES.helper)
    ),
  evidencePatched:
    evidence.includes(
      "verifiedLedgerAppend"
    ),
  dashboardPatched:
    dashboard.includes(
      "provenanceBlockedCount"
    ) &&
    dashboard.includes(
      "gateInvalidCount"
    ),
  monitorPatched:
    monitor.includes(
      "provenanceIssues"
    ) &&
    monitor.includes(
      "ledgerIntegrityIssues"
    ),
  contractGenerated:
    fs.existsSync(
      abs(FILES.contract)
    ),
  staticGenerated:
    fs.existsSync(
      abs(FILES.static)
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

if (failed.length > 0) {
  fail(
    "POST_PATCH_CHECK_FAILED",
    {
      checks,
      failed
    }
  );
  return;
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_VERIFIED_PROVENANCE_LEDGER_V1_REPAIRED",
      createdFiles: [
        FILES.helper,
        FILES.contract,
        FILES.static
      ],
      changedFiles: [
        FILES.evidence,
        FILES.dashboard,
        FILES.monitor
      ],
      backups,
      contract: {
        ledger:
          "logs/true-forward-oos-controlled-producer-evidence-ledger-v1.jsonl",
        hashChain:
          "SHA256_PREVIOUS_ENTRY_HASH",
        appendPolicy:
          "ONLY VERIFIED CONTROLLED NORMAL RUN WITH EXACTLY ONE NEW SESSION",
        sessionAcceptance:
          "RUN_ID + SESSION_KEY + FINGERPRINT + INTEGRITY_HASH MUST MATCH LEDGER",
        dashboard:
          "UNVERIFIED CANONICAL SESSION EXCLUDED AND GATE BLOCKED",
        integrityMonitor:
          "UNVERIFIED SESSION OR INVALID LEDGER BLOCKS EVIDENCE",
        zeroSessionBehavior:
          "WAIT NORMAL"
      },
      checks,
      safety: {
        producerExecuted: false,
        collectorExecuted: false,
        projectLedgerWritten: false,
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        promotionExecuted: false,
        realTradingEnabled: false
      },
      failed: [],
      nextAction:
        "RUN_STATIC_LEDGER_CONTRACT_FORWARD_PIPELINE_DASHBOARD_INTEGRITY_APP_TSC_BUILD"
    },
    null,
    2
  )
);

process.exitCode = 0;
