const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-krx-maturity-semantics-exact-probe-v1.cjs"
);

const backupDir = path.join(
  ROOT,
  "scripts",
  "backups"
);

const backup = path.join(
  backupDir,
  "true-forward-oos-krx-maturity-semantics-exact-probe-v1.before-base64-fix-v3.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_PROBE_BASE64_FIX_V3_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(target)) {
  fail(
    "PROBE_FILE_NOT_FOUND",
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
    "Y29uc3QgZnMgPSByZXF1aXJlKCJmcyIpOwpjb25zdCBwYXRoID0gcmVxdWlyZSgicGF0aCIpOwoKY29uc3QgUk9PVCA9IHByb2Nlc3MuY3dkKCk7Cgpjb25zdCBBVURJVF9GSUxFID0KICAic2NyaXB0cy90cnVlLWZvcndhcmQtb29zLXBvc3QtY2FwdHVyZS1tYXR1cml0eS1hdWRpdC12MS50cyI7Cgpjb25zdCBLUlhfRklMRSA9CiAgImxpYi90cmFkaW5nL2tyeC10cmFkaW5nLWNhbGVuZGFyLnRzIjsKCmZ1bmN0aW9uIHJlYWQocmVsKSB7CiAgcmV0dXJuIGZzLnJlYWRGaWxlU3luYygKICAgIHBhdGguam9pbigKICAgICAgUk9PVCwKICAgICAgcmVsLAogICAgKSwKICAgICJ1dGY4IiwKICApOwp9CgpmdW5jdGlvbiBmaW5kRnVuY3Rpb25TdGFydCgKICBzb3VyY2UsCiAgbmFtZSwKKSB7CiAgY29uc3QgY2FuZGlkYXRlcyA9IFsKICAgICJleHBvcnQgYXN5bmMgZnVuY3Rpb24gIiArIG5hbWUgKyAiKCIsCiAgICAiZXhwb3J0IGZ1bmN0aW9uICIgKyBuYW1lICsgIigiLAogICAgImFzeW5jIGZ1bmN0aW9uICIgKyBuYW1lICsgIigiLAogICAgImZ1bmN0aW9uICIgKyBuYW1lICsgIigiLAogIF07CgogIGxldCBiZXN0ID0gLTE7CgogIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHsKICAgIGNvbnN0IGluZGV4ID0KICAgICAgc291cmNlLmluZGV4T2YoCiAgICAgICAgY2FuZGlkYXRlLAogICAgICApOwoKICAgIGlmICgKICAgICAgaW5kZXggPj0gMCAmJgogICAgICAoCiAgICAgICAgYmVzdCA8IDAgfHwKICAgICAgICBpbmRleCA8IGJlc3QKICAgICAgKQogICAgKSB7CiAgICAgIGJlc3QgPSBpbmRleDsKICAgIH0KICB9CgogIHJldHVybiBiZXN0Owp9CgpmdW5jdGlvbiBleHRyYWN0RnVuY3Rpb24oCiAgc291cmNlLAogIG5hbWUsCikgewogIGNvbnN0IHN0YXJ0ID0KICAgIGZpbmRGdW5jdGlvblN0YXJ0KAogICAgICBzb3VyY2UsCiAgICAgIG5hbWUsCiAgICApOwoKICBpZiAoc3RhcnQgPCAwKSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGNvbnN0IGJyYWNlU3RhcnQgPQogICAgc291cmNlLmluZGV4T2YoCiAgICAgICJ7IiwKICAgICAgc3RhcnQsCiAgICApOwoKICBpZiAoYnJhY2VTdGFydCA8IDApIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgbGV0IGRlcHRoID0gMDsKICBsZXQgcXVvdGUgPSBudWxsOwogIGxldCBlc2NhcGVkID0gZmFsc2U7CiAgbGV0IGxpbmVDb21tZW50ID0gZmFsc2U7CiAgbGV0IGJsb2NrQ29tbWVudCA9IGZhbHNlOwoKICBmb3IgKAogICAgbGV0IGkgPSBicmFjZVN0YXJ0OwogICAgaSA8IHNvdXJjZS5sZW5ndGg7CiAgICBpKysKICApIHsKICAgIGNvbnN0IGNoID0gc291cmNlW2ldOwogICAgY29uc3QgbmV4dCA9IHNvdXJjZVtpICsgMV07CgogICAgaWYgKGxpbmVDb21tZW50KSB7CiAgICAgIGlmIChjaCA9PT0gIlxuIikgewogICAgICAgIGxpbmVDb21tZW50ID0gZmFsc2U7CiAgICAgIH0KICAgICAgY29udGludWU7CiAgICB9CgogICAgaWYgKGJsb2NrQ29tbWVudCkgewogICAgICBpZiAoCiAgICAgICAgY2ggPT09ICIqIiAmJgogICAgICAgIG5leHQgPT09ICIvIgogICAgICApIHsKICAgICAgICBibG9ja0NvbW1lbnQgPSBmYWxzZTsKICAgICAgICBpICs9IDE7CiAgICAgIH0KICAgICAgY29udGludWU7CiAgICB9CgogICAgaWYgKGVzY2FwZWQpIHsKICAgICAgZXNjYXBlZCA9IGZhbHNlOwogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBpZiAocXVvdGUgIT09IG51bGwpIHsKICAgICAgaWYgKGNoID09PSAiXFwiKSB7CiAgICAgICAgZXNjYXBlZCA9IHRydWU7CiAgICAgICAgY29udGludWU7CiAgICAgIH0KCiAgICAgIGlmIChjaCA9PT0gcXVvdGUpIHsKICAgICAgICBxdW90ZSA9IG51bGw7CiAgICAgIH0KCiAgICAgIGNvbnRpbnVlOwogICAgfQoKICAgIGlmICgKICAgICAgY2ggPT09ICIvIiAmJgogICAgICBuZXh0ID09PSAiLyIKICAgICkgewogICAgICBsaW5lQ29tbWVudCA9IHRydWU7CiAgICAgIGkgKz0gMTsKICAgICAgY29udGludWU7CiAgICB9CgogICAgaWYgKAogICAgICBjaCA9PT0gIi8iICYmCiAgICAgIG5leHQgPT09ICIqIgogICAgKSB7CiAgICAgIGJsb2NrQ29tbWVudCA9IHRydWU7CiAgICAgIGkgKz0gMTsKICAgICAgY29udGludWU7CiAgICB9CgogICAgaWYgKAogICAgICBjaCA9PT0gIiciIHx8CiAgICAgIGNoID09PSAnIicgfHwKICAgICAgY2ggPT09ICJgIgogICAgKSB7CiAgICAgIHF1b3RlID0gY2g7CiAgICAgIGNvbnRpbnVlOwogICAgfQoKICAgIGlmIChjaCA9PT0gInsiKSB7CiAgICAgIGRlcHRoICs9IDE7CiAgICAgIGNvbnRpbnVlOwogICAgfQoKICAgIGlmIChjaCA9PT0gIn0iKSB7CiAgICAgIGRlcHRoIC09IDE7CgogICAgICBpZiAoZGVwdGggPT09IDApIHsKICAgICAgICByZXR1cm4gc291cmNlLnNsaWNlKAogICAgICAgICAgc3RhcnQsCiAgICAgICAgICBpICsgMSwKICAgICAgICApOwogICAgICB9CiAgICB9CiAgfQoKICByZXR1cm4gc291cmNlLnNsaWNlKHN0YXJ0KTsKfQoKZnVuY3Rpb24gZXhwb3J0ZWRGdW5jdGlvbnMoCiAgc291cmNlLAopIHsKICBjb25zdCBuYW1lcyA9IFtdOwoKICBjb25zdCBwYXR0ZXJucyA9IFsKICAgICJleHBvcnQgYXN5bmMgZnVuY3Rpb24gIiwKICAgICJleHBvcnQgZnVuY3Rpb24gIiwKICBdOwoKICBmb3IgKGNvbnN0IG1hcmtlciBvZiBwYXR0ZXJucykgewogICAgbGV0IG9mZnNldCA9IDA7CgogICAgd2hpbGUgKG9mZnNldCA8IHNvdXJjZS5sZW5ndGgpIHsKICAgICAgY29uc3QgaW5kZXggPQogICAgICAgIHNvdXJjZS5pbmRleE9mKAogICAgICAgICAgbWFya2VyLAogICAgICAgICAgb2Zmc2V0LAogICAgICAgICk7CgogICAgICBpZiAoaW5kZXggPCAwKSB7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KCiAgICAgIGNvbnN0IG5hbWVTdGFydCA9CiAgICAgICAgaW5kZXggKwogICAgICAgIG1hcmtlci5sZW5ndGg7CgogICAgICBsZXQgbmFtZUVuZCA9CiAgICAgICAgbmFtZVN0YXJ0OwoKICAgICAgd2hpbGUgKAogICAgICAgIG5hbWVFbmQgPCBzb3VyY2UubGVuZ3RoICYmCiAgICAgICAgL1tBLVphLXowLTlfJF0vLnRlc3QoCiAgICAgICAgICBzb3VyY2VbbmFtZUVuZF0sCiAgICAgICAgKQogICAgICApIHsKICAgICAgICBuYW1lRW5kICs9IDE7CiAgICAgIH0KCiAgICAgIGNvbnN0IG5hbWUgPQogICAgICAgIHNvdXJjZS5zbGljZSgKICAgICAgICAgIG5hbWVTdGFydCwKICAgICAgICAgIG5hbWVFbmQsCiAgICAgICAgKTsKCiAgICAgIGlmICgKICAgICAgICBuYW1lICYmCiAgICAgICAgIW5hbWVzLmluY2x1ZGVzKG5hbWUpCiAgICAgICkgewogICAgICAgIG5hbWVzLnB1c2gobmFtZSk7CiAgICAgIH0KCiAgICAgIG9mZnNldCA9CiAgICAgICAgTWF0aC5tYXgoCiAgICAgICAgICBuYW1lRW5kICsgMSwKICAgICAgICAgIGluZGV4ICsgbWFya2VyLmxlbmd0aCwKICAgICAgICApOwogICAgfQogIH0KCiAgcmV0dXJuIG5hbWVzOwp9Cgpjb25zdCBhdWRpdCA9IHJlYWQoQVVESVRfRklMRSk7CmNvbnN0IGtyeCA9IHJlYWQoS1JYX0ZJTEUpOwoKY29uc3QgdGFyZ2V0RnVuY3Rpb25zID0gWwogICJidWlsZE1hdHVyaXR5U2NoZWR1bGUiLAogICJidWlsZFNlc3Npb25JbnRlZ3JpdHkiLAogICJhdWRpdEZvcndhcmRTZXNzaW9ucyIsCl07Cgpjb25zdCBib2RpZXMgPSB7fTsKCmZvciAoY29uc3QgbmFtZSBvZiB0YXJnZXRGdW5jdGlvbnMpIHsKICBib2RpZXNbbmFtZV0gPQogICAgZXh0cmFjdEZ1bmN0aW9uKAogICAgICBhdWRpdCwKICAgICAgbmFtZSwKICAgICk7Cn0KCmNvbnN0IGFsbEF1ZGl0RXhwb3J0cyA9CiAgZXhwb3J0ZWRGdW5jdGlvbnMoYXVkaXQpOwoKY29uc3QgYWxsS3J4RXhwb3J0cyA9CiAgZXhwb3J0ZWRGdW5jdGlvbnMoa3J4KTsKCmNvbnN0IGNvbWJpbmVkQm9kaWVzID0KICBPYmplY3QudmFsdWVzKGJvZGllcykKICAgIC5maWx0ZXIoQm9vbGVhbikKICAgIC5qb2luKCJcblxuIik7Cgpjb25zdCBhdWRpdEltcG9ydHNLcnggPQogIGF1ZGl0LmluY2x1ZGVzKAogICAgImtyeC10cmFkaW5nLWNhbGVuZGFyIiwKICApOwoKY29uc3QgYm9keVJlZmVyZW5jZXNLcnhFeHBvcnQgPQogIGFsbEtyeEV4cG9ydHMuZmlsdGVyKAogICAgbmFtZSA9PgogICAgICBjb21iaW5lZEJvZGllcy5pbmNsdWRlcyhuYW1lKSwKICApOwoKY29uc3QgY2FsZW5kYXJBcml0aG1ldGljU2lnbmFscyA9IHsKICBzZXREYXRlOgogICAgY29tYmluZWRCb2RpZXMuaW5jbHVkZXMoCiAgICAgICIuc2V0RGF0ZSgiLAogICAgKSwKCiAgc2V0VVRDRGF0ZToKICAgIGNvbWJpbmVkQm9kaWVzLmluY2x1ZGVzKAogICAgICAiLnNldFVUQ0RhdGUoIiwKICAgICksCgogIGRhdGVBZGRNaWxsaXNlY29uZHM6CiAgICBjb21iaW5lZEJvZGllcy5pbmNsdWRlcygKICAgICAgIjg2NDAwMDAwIiwKICAgICkgfHwKICAgIGNvbWJpbmVkQm9kaWVzLmluY2x1ZGVzKAogICAgICAiMjQgKiA2MCAqIDYwICogMTAwMCIsCiAgICApIHx8CiAgICBjb21iaW5lZEJvZGllcy5pbmNsdWRlcygKICAgICAgIjI0KjYwKjYwKjEwMDAiLAogICAgKSwKCiAgZGF0ZUNvbnN0cnVjdG9yUHJlc2VudDoKICAgIGNvbWJpbmVkQm9kaWVzLmluY2x1ZGVzKAogICAgICAibmV3IERhdGUoIiwKICAgICksCn07Cgpjb25zdCBzZXNzaW9uQXJpdGhtZXRpY1NpZ25hbHMgPSB7CiAgdXNlc1RhcmdldFNlc3Npb25EYXRlOgogICAgY29tYmluZWRCb2RpZXMuaW5jbHVkZXMoCiAgICAgICJ0YXJnZXRTZXNzaW9uRGF0ZSIsCiAgICApLAoKICB1c2VzU291cmNlVHJhZGluZ0RhdGU6CiAgICBjb21iaW5lZEJvZGllcy5pbmNsdWRlcygKICAgICAgInNvdXJjZVRyYWRpbmdEYXRlIiwKICAgICksCgogIHVzZXNUcmFkaW5nRGF0ZXNBcnJheToKICAgIFsKICAgICAgInRyYWRpbmdEYXRlcyIsCiAgICAgICJzZXNzaW9uRGF0ZXMiLAogICAgICAibWFya2V0U2Vzc2lvbnMiLAogICAgICAib3BlbkRhdGVzIiwKICAgICAgInRyYWRpbmdEYXlzIiwKICAgIF0uc29tZSgKICAgICAgdG9rZW4gPT4KICAgICAgICBjb21iaW5lZEJvZGllcy5pbmNsdWRlcyh0b2tlbiksCiAgICApLAoKICB1c2VzS3J4SW1wb3J0OgogICAgYXVkaXRJbXBvcnRzS3J4LAoKICByZWZlcmVuY2VzS3J4RXhwb3J0OgogICAgYm9keVJlZmVyZW5jZXNLcnhFeHBvcnQubGVuZ3RoID4gMCwKfTsKCmxldCBzZW1hbnRpY0Fzc2Vzc21lbnQgPQogICJJTkNPTkNMVVNJVkUiOwoKaWYgKAogIHNlc3Npb25Bcml0aG1ldGljU2lnbmFscy51c2VzS3J4SW1wb3J0ICYmCiAgc2Vzc2lvbkFyaXRobWV0aWNTaWduYWxzLnJlZmVyZW5jZXNLcnhFeHBvcnQKKSB7CiAgc2VtYW50aWNBc3Nlc3NtZW50ID0KICAgICJLUlhfVFJBRElOR19TRVNTSU9OX0JPVU5EIjsKfSBlbHNlIGlmICgKICBjYWxlbmRhckFyaXRobWV0aWNTaWduYWxzLnNldERhdGUgfHwKICBjYWxlbmRhckFyaXRobWV0aWNTaWduYWxzLnNldFVUQ0RhdGUgfHwKICBjYWxlbmRhckFyaXRobWV0aWNTaWduYWxzLmRhdGVBZGRNaWxsaXNlY29uZHMKKSB7CiAgc2VtYW50aWNBc3Nlc3NtZW50ID0KICAgICJDQUxFTkRBUl9EQVlfQVJJVEhNRVRJQ19ERVRFQ1RFRCI7Cn0gZWxzZSBpZiAoCiAgc2Vzc2lvbkFyaXRobWV0aWNTaWduYWxzLnVzZXNUYXJnZXRTZXNzaW9uRGF0ZSAmJgogICFzZXNzaW9uQXJpdGhtZXRpY1NpZ25hbHMudXNlc0tyeEltcG9ydAopIHsKICBzZW1hbnRpY0Fzc2Vzc21lbnQgPQogICAgIlRBUkdFVF9TRVNTSU9OX0RBVEVfRFJJVkVOX05FRURTX0VYQUNUX1NPVVJDRV9SRVZJRVciOwp9Cgpjb25zdCByZXBvcnQgPSB7CiAgc3RhdHVzOgogICAgIkFJX1NUT0NLX0xBQl9UUlVFX0ZPUldBUkRfT09TX0tSWF9NQVRVUklUWV9TRU1BTlRJQ1NfRVhBQ1RfUFJPQkVfVjNfQ09NUExFVEUiLAoKICBwcm9iZVZlcnNpb246CiAgICAiVjNfQkFTRTY0X1NBRkVfU1RSSU5HX0ZVTkNUSU9OX0VYVFJBQ1RJT04iLAoKICBtb2RlOgogICAgIlJFQURfT05MWV9FWEFDVF9GVU5DVElPTl9CT0RZX1BST0JFIiwKCiAgZmlsZXM6IHsKICAgIG1hdHVyaXR5QXVkaXQ6CiAgICAgIEFVRElUX0ZJTEUsCgogICAga3J4Q2FsZW5kYXI6CiAgICAgIEtSWF9GSUxFLAogIH0sCgogIGF1ZGl0RXhwb3J0czoKICAgIGFsbEF1ZGl0RXhwb3J0cywKCiAga3J4RXhwb3J0czoKICAgIGFsbEtyeEV4cG9ydHMsCgogIHRhcmdldEZ1bmN0aW9uczoKICAgIE9iamVjdC5mcm9tRW50cmllcygKICAgICAgT2JqZWN0LmVudHJpZXMoYm9kaWVzKQogICAgICAgIC5tYXAoCiAgICAgICAgICAoW25hbWUsIGJvZHldKSA9PiBbCiAgICAgICAgICAgIG5hbWUsCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICBmb3VuZDoKICAgICAgICAgICAgICAgICEhYm9keSwKCiAgICAgICAgICAgICAgc291cmNlOgogICAgICAgICAgICAgICAgYm9keSwKICAgICAgICAgICAgfSwKICAgICAgICAgIF0sCiAgICAgICAgKSwKICAgICksCgogIGJpbmRpbmc6IHsKICAgIGF1ZGl0SW1wb3J0c0tyeCwKICAgIGJvZHlSZWZlcmVuY2VzS3J4RXhwb3J0LAogIH0sCgogIGNhbGVuZGFyQXJpdGhtZXRpY1NpZ25hbHMsCiAgc2Vzc2lvbkFyaXRobWV0aWNTaWduYWxzLAoKICBzZW1hbnRpY0Fzc2Vzc21lbnQsCgogIGRlY2lzaW9uOiB7CiAgICBuZWVkc1JlcGFpcjoKICAgICAgc2VtYW50aWNBc3Nlc3NtZW50ID09PQogICAgICAiQ0FMRU5EQVJfREFZX0FSSVRITUVUSUNfREVURUNURUQiLAoKICAgIG5lZWRzRnVydGhlckV4YWN0UmV2aWV3OgogICAgICBzZW1hbnRpY0Fzc2Vzc21lbnQgPT09CiAgICAgICAgIklOQ09OQ0xVU0lWRSIgfHwKICAgICAgc2VtYW50aWNBc3Nlc3NtZW50ID09PQogICAgICAgICJUQVJHRVRfU0VTU0lPTl9EQVRFX0RSSVZFTl9ORUVEU19FWEFDVF9TT1VSQ0VfUkVWSUVXIiwKCiAgICBzYWZlVG9MZWF2ZUFzSXM6CiAgICAgIHNlbWFudGljQXNzZXNzbWVudCA9PT0KICAgICAgIktSWF9UUkFESU5HX1NFU1NJT05fQk9VTkQiLAogIH0sCgogIHNhZmV0eTogewogICAgc291cmNlT25seToKICAgICAgdHJ1ZSwKCiAgICBtYXR1cml0eUF1ZGl0RXhlY3V0ZWQ6CiAgICAgIGZhbHNlLAoKICAgIGNvbGxlY3RvckV4ZWN1dGVkOgogICAgICBmYWxzZSwKCiAgICBuZXR3b3JrUmVxdWVzdHM6CiAgICAgIDAsCgogICAgZGF0YWJhc2VSZWFkczoKICAgICAgMCwKCiAgICBkYXRhYmFzZVdyaXRlczoKICAgICAgMCwKCiAgICBvcmRlcnNDcmVhdGVkOgogICAgICAwLAoKICAgIHBvc2l0aW9uc0NoYW5nZWQ6CiAgICAgIDAsCgogICAgcHJvbW90aW9uRXhlY3V0ZWQ6CiAgICAgIGZhbHNlLAoKICAgIHJlYWxUcmFkaW5nRW5hYmxlZDoKICAgICAgZmFsc2UsCiAgfSwKCiAgbmV4dEdhdGU6CiAgICBzZW1hbnRpY0Fzc2Vzc21lbnQgPT09CiAgICAgICJLUlhfVFJBRElOR19TRVNTSU9OX0JPVU5EIgogICAgICA/ICJWRVJJRllfRklSU1RfUkVBTF9GT1JXQVJEX1NFU1NJT05fUkVBRElORVNTIgogICAgICA6ICJSRVBBSVJfT1JfQklORF9LUlhfVFJBRElOR19TRVNTSU9OX01BVFVSSVRZX0JFRk9SRV9GSVJTVF9SRUFMX0ZPUldBUkRfU0VTU0lPTiIsCn07Cgpmcy5ta2RpclN5bmMoCiAgcGF0aC5qb2luKAogICAgUk9PVCwKICAgICJsb2dzIiwKICApLAogIHsKICAgIHJlY3Vyc2l2ZToKICAgICAgdHJ1ZSwKICB9LAopOwoKZnMud3JpdGVGaWxlU3luYygKICBwYXRoLmpvaW4oCiAgICBST09ULAogICAgImxvZ3MiLAogICAgInRydWUtZm9yd2FyZC1vb3Mta3J4LW1hdHVyaXR5LXNlbWFudGljcy1leGFjdC1wcm9iZS12My5qc29uIiwKICApLAogIEpTT04uc3RyaW5naWZ5KAogICAgcmVwb3J0LAogICAgbnVsbCwKICAgIDIsCiAgKSArICJcbiIsCiAgInV0ZjgiLAopOwoKY29uc29sZS5sb2coCiAgSlNPTi5zdHJpbmdpZnkoCiAgICByZXBvcnQsCiAgICBudWxsLAogICAgMiwKICApLAopOwoKcHJvY2Vzcy5leGl0Q29kZSA9IDA7Cg==";

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
    v3Installed:
      written.includes(
        "V3_BASE64_SAFE_STRING_FUNCTION_EXTRACTION"
      ),

    noDynamicFunctionRegExp:
      !written.includes(
        "new RegExp("
      ),

    stringFunctionDiscovery:
      written.includes(
        "findFunctionStart("
      ),

    braceBalancedExtraction:
      written.includes(
        "extractFunction("
      ) &&
      written.includes(
        "depth += 1"
      ) &&
      written.includes(
        "depth -= 1"
      ),

    targetFunctionsPreserved:
      written.includes(
        "\"buildMaturitySchedule\""
      ) &&
      written.includes(
        "\"buildSessionIntegrity\""
      ) &&
      written.includes(
        "\"auditForwardSessions\""
      ),

    productSourceChanges:
      true,

    tradingLogicChanges:
      true,
  };

  const failed = [];

  if (!checks.v3Installed) {
    failed.push(
      "V3_PROBE_NOT_INSTALLED"
    );
  }

  if (!checks.noDynamicFunctionRegExp) {
    failed.push(
      "DYNAMIC_REGEXP_REMAINS"
    );
  }

  if (!checks.stringFunctionDiscovery) {
    failed.push(
      "STRING_FUNCTION_DISCOVERY_MISSING"
    );
  }

  if (!checks.braceBalancedExtraction) {
    failed.push(
      "BRACE_BALANCED_EXTRACTION_MISSING"
    );
  }

  if (!checks.targetFunctionsPreserved) {
    failed.push(
      "TARGET_FUNCTIONS_MISSING"
    );
  }

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_PROBE_BASE64_FIX_V3_REPAIRED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_MATURITY_SEMANTICS_PROBE_BASE64_FIX_V3_FAILED",

    changedFile:
      "scripts/true-forward-oos-krx-maturity-semantics-exact-probe-v1.cjs",

    backupFile:
      "scripts/backups/true-forward-oos-krx-maturity-semantics-exact-probe-v1.before-base64-fix-v3.cjs",

    repair: {
      previousFailure:
        "NESTED_TEMPLATE_LITERAL_BACKTICK_TERMINATED_FIX_SCRIPT",

      newStrategy:
        "BASE64_PAYLOAD_DECODE_TO_TARGET_PROBE",

      nestedTemplateLiteral:
        "REMOVED_FROM_FIX_PATH",

      dynamicFunctionRegex:
        "REMOVED"
    },

    checks: {
      v3Installed:
        checks.v3Installed,

      noDynamicFunctionRegExp:
        checks.noDynamicFunctionRegExp,

      stringFunctionDiscovery:
        checks.stringFunctionDiscovery,

      braceBalancedExtraction:
        checks.braceBalancedExtraction,

      targetFunctionsPreserved:
        checks.targetFunctionsPreserved,

      productSourceChanges:
        0,

      tradingLogicChanges:
        0,
    },

    safety: {
      probeExecutedByFix:
        false,

      maturityAuditExecuted:
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
        ? "NODE_CHECK_AND_RERUN_KRX_MATURITY_SEMANTICS_PROBE"
        : "INSPECT_BASE64_PROBE_FIX_V3"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
