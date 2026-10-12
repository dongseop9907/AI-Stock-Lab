#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();
const SCRIPTS_DIR = path.join(ROOT, "scripts");
const REPORT_DIR = path.join(ROOT, "reports");

const HEAVY_EXCLUDES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".vercel",
  "out",
]);

const TEXT_EXTS = new Set([
  ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx",
  ".json", ".md", ".txt", ".yml", ".yaml",
  ".ps1", ".cmd", ".bat", ".sh",
  ".sql", ".env", ".toml"
]);

const SCRIPT_EXTS = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx"]);

const TEMP_EXTS = new Set([
  ".tmp", ".temp", ".bak", ".old", ".orig", ".rej", ".log"
]);

const SAFE_CACHE_DIRS = [
  ".next",
  "coverage",
  ".turbo",
  ".cache",
];

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function isTextFile(file) {
  const base = path.basename(file).toLowerCase();
  const ext = path.extname(base);
  return TEXT_EXTS.has(ext) ||
    base === "package.json" ||
    base === "tsconfig.json" ||
    base === "next.config.js" ||
    base === "next.config.mjs" ||
    base === "next.config.ts" ||
    base === "wrangler.toml";
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (HEAVY_EXCLUDES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function gitTrackedSet() {
  try {
    const out = cp.execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(out.split("\0").filter(Boolean).map(x => x.replace(/\\/g, "/")));
  } catch {
    return new Set();
  }
}

function gitStatusMap() {
  try {
    const out = cp.execFileSync("git", ["status", "--porcelain", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parts = out.split("\0").filter(Boolean);
    const map = new Map();
    for (const part of parts) {
      if (part.length < 4) continue;
      const code = part.slice(0, 2);
      const file = part.slice(3).replace(/\\/g, "/");
      map.set(file, code);
    }
    return map;
  } catch {
    return new Map();
  }
}

function readPackageJson() {
  const p = path.join(ROOT, "package.json");
  if (!exists(p)) return { raw: "", scripts: {} };
  try {
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    return { raw, scripts: json.scripts || {} };
  } catch {
    return { raw: "", scripts: {} };
  }
}

function getAgeDays(st) {
  return st ? Math.floor((Date.now() - st.mtimeMs) / 86400000) : null;
}

function looksTemporary(file) {
  const base = path.basename(file).toLowerCase();
  const ext = path.extname(base);
  if (TEMP_EXTS.has(ext)) return true;
  if (base.startsWith("npm-debug")) return true;
  if (base.startsWith("yarn-error")) return true;
  if (base.startsWith("pnpm-debug")) return true;
  if (base.endsWith("~")) return true;
  if (/^\.#/.test(base)) return true;
  return false;
}

function scriptKind(rp) {
  const base = path.basename(rp).toLowerCase();

  if (/^(install|fix|patch|migrate|migration|repair|hotfix|temp|tmp)[-_]/.test(base)) {
    return "ONE_TIME_OR_REPAIR";
  }
  if (/^v\d+(?:[-_.]\d+)*/.test(base)) {
    return "VERSIONED_LEGACY_CANDIDATE";
  }
  if (/(probe|debug|scratch|experiment|replay|backfill|audit)/.test(base)) {
    return "DIAGNOSTIC_OR_ANALYSIS";
  }
  return "GENERAL_SCRIPT";
}

function contentIndex(files) {
  const entries = [];
  for (const f of files) {
    if (!isTextFile(f)) continue;
    try {
      const st = fs.statSync(f);
      if (st.size > 2_000_000) continue;
      entries.push({
        file: f,
        rel: rel(f),
        text: fs.readFileSync(f, "utf8").toLowerCase()
      });
    } catch {}
  }
  return entries;
}

function referenceHits(targetRel, targetBase, index) {
  const needleBase = targetBase.toLowerCase();
  const needleRel = targetRel.toLowerCase().replace(/\\/g, "/");
  const noExt = needleBase.replace(/\.[^.]+$/, "");

  const hits = [];
  for (const item of index) {
    if (item.rel.toLowerCase() === targetRel.toLowerCase()) continue;

    const txt = item.text;
    if (
      txt.includes(needleRel) ||
      txt.includes(`./${needleRel}`) ||
      txt.includes(needleBase) ||
      (noExt.length >= 8 && txt.includes(noExt))
    ) {
      hits.push(item.rel);
      if (hits.length >= 20) break;
    }
  }
  return hits;
}

function isPackageScriptReferenced(targetRel, targetBase, packageScripts) {
  const base = targetBase.toLowerCase();
  const rp = targetRel.toLowerCase();
  for (const [name, cmd] of Object.entries(packageScripts)) {
    const c = String(cmd).toLowerCase();
    if (c.includes(base) || c.includes(rp)) return name;
  }
  return null;
}

function classifyScript(item) {
  if (item.packageScript) {
    return {
      category: "KEEP",
      reason: `package.json script에서 사용됨: ${item.packageScript}`
    };
  }

  if (item.references.length > 0) {
    return {
      category: "KEEP",
      reason: `다른 파일에서 참조됨 (${item.references.length}개 감지)`
    };
  }

  if (item.gitStatus && item.gitStatus.includes("?")) {
    return {
      category: "REVIEW",
      reason: "Git 미추적 스크립트이며 참조가 감지되지 않음"
    };
  }

  if (item.kind === "ONE_TIME_OR_REPAIR" && item.ageDays >= 3) {
    return {
      category: "REVIEW",
      reason: "설치/수정/마이그레이션 계열 1회성 가능성이 높고 참조 없음"
    };
  }

  if (item.kind === "VERSIONED_LEGACY_CANDIDATE" && item.ageDays >= 7) {
    return {
      category: "REVIEW",
      reason: "버전형 레거시 스크립트로 보이며 참조 없음"
    };
  }

  if (item.kind === "DIAGNOSTIC_OR_ANALYSIS" && item.ageDays >= 7) {
    return {
      category: "REVIEW",
      reason: "진단/분석용 스크립트로 보이며 참조 없음"
    };
  }

  return {
    category: "KEEP",
    reason: "자동 판정만으로 미사용 여부를 확정하기 어려움"
  };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const allFiles = walk(ROOT);
  const tracked = gitTrackedSet();
  const status = gitStatusMap();
  const pkg = readPackageJson();
  const index = contentIndex(allFiles);

  const items = [];

  // 1) scripts 폴더의 스크립트 분석
  if (exists(SCRIPTS_DIR)) {
    const scriptFiles = walk(SCRIPTS_DIR).filter(f => SCRIPT_EXTS.has(path.extname(f).toLowerCase()));

    for (const file of scriptFiles) {
      const rp = rel(file);
      const st = statSafe(file);
      const base = path.basename(file);
      const refs = referenceHits(rp, base, index);
      const packageScript = isPackageScriptReferenced(rp, base, pkg.scripts);

      const item = {
        type: "SCRIPT",
        path: rp,
        tracked: tracked.has(rp),
        gitStatus: status.get(rp) || "",
        ageDays: getAgeDays(st),
        sizeBytes: st?.size ?? null,
        kind: scriptKind(rp),
        packageScript,
        references: refs,
      };

      Object.assign(item, classifyScript(item));
      items.push(item);
    }
  }

  // 2) 프로젝트 전역 임시/백업 파일
  for (const file of allFiles) {
    const rp = rel(file);
    if (rp.startsWith("reports/cleanup-audit-")) continue;
    if (!looksTemporary(file)) continue;

    const st = statSafe(file);
    const isTracked = tracked.has(rp);

    items.push({
      type: "TEMP_FILE",
      path: rp,
      tracked: isTracked,
      gitStatus: status.get(rp) || "",
      ageDays: getAgeDays(st),
      sizeBytes: st?.size ?? null,
      kind: "TEMP_OR_BACKUP",
      packageScript: null,
      references: [],
      category: isTracked ? "REVIEW" : "SAFE_CLEAN",
      reason: isTracked
        ? "임시/백업 파일처럼 보이지만 Git 추적 중이라 검토 필요"
        : "Git 미추적 임시/백업 파일"
    });
  }

  // 3) 재생성 가능한 캐시 디렉터리
  for (const d of SAFE_CACHE_DIRS) {
    const full = path.join(ROOT, d);
    if (!exists(full)) continue;

    let bytes = 0;
    for (const f of walk(full)) {
      const st = statSafe(f);
      if (st) bytes += st.size;
    }

    items.push({
      type: "CACHE_DIR",
      path: d + "/",
      tracked: false,
      gitStatus: "",
      ageDays: null,
      sizeBytes: bytes,
      kind: "REGENERATABLE_CACHE",
      packageScript: null,
      references: [],
      category: "SAFE_CLEAN",
      reason: "빌드/테스트 시 다시 생성 가능한 캐시 디렉터리"
    });
  }

  const order = { SAFE_CLEAN: 0, REVIEW: 1, KEEP: 2 };
  items.sort((a, b) =>
    (order[a.category] ?? 9) - (order[b.category] ?? 9) ||
    a.path.localeCompare(b.path)
  );

  const summary = {
    root: ROOT,
    generatedAt: new Date().toISOString(),
    counts: {
      total: items.length,
      safeClean: items.filter(x => x.category === "SAFE_CLEAN").length,
      review: items.filter(x => x.category === "REVIEW").length,
      keep: items.filter(x => x.category === "KEEP").length,
    },
    notes: [
      "이 보고서는 자동 추정 결과입니다.",
      "REVIEW 항목은 삭제 전 반드시 확인해야 합니다.",
      "SAFE_CLEAN은 캐시/미추적 임시 파일 위주로만 분류합니다.",
      "동적 import, 수동 실행, 외부 문서에 적힌 실행 경로는 자동 탐지하지 못할 수 있습니다."
    ]
  };

  ensureDir(REPORT_DIR);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `cleanup-audit-${stamp}.json`);
  const txtPath = path.join(REPORT_DIR, `cleanup-audit-${stamp}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, items }, null, 2), "utf8");

  const lines = [];
  lines.push("=== AI STOCK LAB CLEANUP AUDIT ===");
  lines.push(`ROOT: ${ROOT}`);
  lines.push(`TOTAL: ${summary.counts.total}`);
  lines.push(`SAFE_CLEAN: ${summary.counts.safeClean}`);
  lines.push(`REVIEW: ${summary.counts.review}`);
  lines.push(`KEEP: ${summary.counts.keep}`);
  lines.push("");

  for (const cat of ["SAFE_CLEAN", "REVIEW", "KEEP"]) {
    lines.push(`=== ${cat} ===`);
    const subset = items.filter(x => x.category === cat);
    if (!subset.length) {
      lines.push("(none)");
      lines.push("");
      continue;
    }

    for (const x of subset) {
      const mb = x.sizeBytes == null ? "" : ` size=${(x.sizeBytes / 1024 / 1024).toFixed(2)}MB`;
      const age = x.ageDays == null ? "" : ` age=${x.ageDays}d`;
      const refs = x.references?.length ? ` refs=${x.references.slice(0, 5).join(",")}` : "";
      lines.push(`[${x.type}] ${x.path}${age}${mb}`);
      lines.push(`  reason: ${x.reason}`);
      if (x.packageScript) lines.push(`  packageScript: ${x.packageScript}`);
      if (refs) lines.push(`  refs: ${x.references.slice(0, 5).join(", ")}`);
    }
    lines.push("");
  }

  lines.push("=== IMPORTANT ===");
  lines.push("이 스크립트는 삭제하지 않습니다. 후보만 분류합니다.");
  lines.push("REVIEW 결과를 확인한 뒤 별도 삭제 스크립트를 만드는 것을 권장합니다.");

  fs.writeFileSync(txtPath, lines.join("\n"), "utf8");

  console.log(lines.join("\n"));
  console.log("");
  console.log(`JSON_REPORT=${jsonPath}`);
  console.log(`TEXT_REPORT=${txtPath}`);
}

main();
