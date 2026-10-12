const { spawnSync } = require("child_process");

const taskName = "AI Stock Lab - SHADOW 0850";

if (process.platform !== "win32") {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SHADOW_0850_TASK_VERIFY_FAILED",
    reason: "WINDOWS_REQUIRED",
  }, null, 2));
  process.exitCode = 1;
} else {
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    "$t = Get-ScheduledTask -TaskName 'AI Stock Lab - SHADOW 0850'",
    "$i = Get-ScheduledTaskInfo -TaskName 'AI Stock Lab - SHADOW 0850'",
    "$o = [pscustomobject]@{ TaskName = $t.TaskName; State = $t.State.ToString(); NextRunTime = $i.NextRunTime; WakeToRun = [bool]$t.Settings.WakeToRun; StartWhenAvailable = [bool]$t.Settings.StartWhenAvailable; Enabled = ($t.State.ToString() -ne 'Disabled') }",
    "$o | ConvertTo-Json -Depth 5",
  ].join("; ");

  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { encoding: "utf8" }
  );

  if (r.status !== 0) {
    console.error(JSON.stringify({
      status: "AI_STOCK_LAB_SHADOW_0850_TASK_VERIFY_FAILED",
      exitCode: r.status,
      stderr: (r.stderr || "").trim(),
    }, null, 2));
    process.exitCode = 1;
  } else {
    let task = null;
    try {
      task = JSON.parse((r.stdout || "").trim());
    } catch {
      task = { raw: (r.stdout || "").trim() };
    }

    const checks = {
      taskName: task && task.TaskName === taskName,
      enabled: task && task.Enabled === true,
      wakeToRun: task && task.WakeToRun === true,
      startWhenAvailable: task && task.StartWhenAvailable === true,
    };

    const failed = Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([k]) => k);

    console.log(JSON.stringify({
      status: failed.length === 0
        ? "AI_STOCK_LAB_SHADOW_0850_TASK_VERIFIED"
        : "AI_STOCK_LAB_SHADOW_0850_TASK_VERIFY_REVIEW",
      task,
      checks,
      failed,
      safety: {
        paperPromotionScheduled: false,
        realTradingEnableScheduled: false,
        shadowProducerOnly: true,
      },
    }, null, 2));

    process.exitCode = failed.length === 0 ? 0 : 1;
  }
}
