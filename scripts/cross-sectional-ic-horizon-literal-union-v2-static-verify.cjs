console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V2_STATIC_SUPERSEDED",
  supersededBy:
    "scripts/build-hygiene-backup-exclusion-and-horizon-static-v3-verify.cjs",
  reason:
    "Old generated verifier contained an invalid regular expression and is no longer authoritative.",
  nextAction:
    "USE_CURRENT_BUILD_HYGIENE_AND_FORWARD_OOS_VERIFIERS"
}, null, 2));

process.exitCode = 0;
