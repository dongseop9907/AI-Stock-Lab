// AI_STOCK_LAB_KIS_SHARED_TOKEN_CACHE_V1
// AWS: shared credential-scoped cache; elsewhere: normal in-process behavior.
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

type IssuedKisToken = {
  access_token: string;
  expires_in?: number | string;
};
type CachedKisToken = { accessToken: string; expiresAt: number };

const AWS_SHARED_BASE = "/opt/ai-stock-lab-cloud/shared";
const MIN_VALIDITY_MS = 60_000;
const WAIT_MILLISECONDS = 200;
const WAIT_ATTEMPTS = 450; // 90 seconds, then fail closed

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  return "code" in error ? String(error.code) : undefined;
}

function sharedRoot(): string | null {
  const explicit = process.env.AI_STOCK_LAB_KIS_TOKEN_CACHE_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  return existsSync(AWS_SHARED_BASE)
    ? path.join(AWS_SHARED_BASE, "kis-token-cache")
    : null;
}

function expiresAtFromIssued(value: number | string | undefined): number {
  const seconds = Number(value);
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
  return Date.now() + safe * 1000;
}

function valid(entry: unknown): entry is CachedKisToken {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as Partial<CachedKisToken>;
  return typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 10 &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt - Date.now() > MIN_VALIDITY_MS;
}

async function ensurePrivateRoot(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(root);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && info.uid !== process.getuid())) {
    throw new Error("KIS_SHARED_CACHE_INSECURE_DIRECTORY");
  }
}

async function readPrivateCache(filename: string): Promise<CachedKisToken | null> {
  let info;
  try {
    info = await fs.lstat(filename);
  } catch (e) {
    if (codeOf(e) === "ENOENT") return null;
    throw e;
  }
  if (!info.isFile() || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && info.uid !== process.getuid())) {
    throw new Error("KIS_SHARED_CACHE_INSECURE_FILE");
  }
  try {
    const value: unknown = JSON.parse(await fs.readFile(filename, "utf8"));
    return valid(value) ? value : null;
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** No secret, app key, or token is logged. Identity includes base URL and credential pair. */
export async function getOrIssueKisSharedToken(
  identity: string,
  issue: () => Promise<IssuedKisToken>,
): Promise<CachedKisToken> {
  const root = sharedRoot();
  if (!root) {
    const issued = await issue();
    if (!issued?.access_token) throw new Error("KIS_TOKEN_ISSUE_EMPTY");
    return { accessToken: issued.access_token, expiresAt: expiresAtFromIssued(issued.expires_in) };
  }
  await ensurePrivateRoot(root);
  const id = createHash("sha256").update(identity).digest("hex");
  const filename = path.join(root, id + ".json");
  const lockdir = path.join(root, id + ".lock");

  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    const existing = await readPrivateCache(filename);
    if (existing) return existing;

    try {
      await fs.mkdir(lockdir, { mode: 0o700 });
    } catch (e) {
      if (codeOf(e) !== "EEXIST") throw e;
      await sleep(WAIT_MILLISECONDS);
      continue;
    }

    let temp: string | null = null;
    try {
      // Recheck after acquiring cross-process lock.
      const fromOtherProcess = await readPrivateCache(filename);
      if (fromOtherProcess) return fromOtherProcess;
      const issued = await issue();
      if (!issued?.access_token) throw new Error("KIS_TOKEN_ISSUE_EMPTY");
      const result = {
        accessToken: issued.access_token,
        expiresAt: expiresAtFromIssued(issued.expires_in),
      };
      temp = filename + "." + process.pid + "." + Date.now() + ".tmp";
      await fs.writeFile(temp, JSON.stringify(result), { mode: 0o600, flag: "wx" });
      await fs.rename(temp, filename);
      temp = null;
      return result;
    } finally {
      if (temp) await fs.rm(temp, { force: true }).catch(() => undefined);
      await fs.rmdir(lockdir).catch(() => undefined);
    }
  }
  // Never bypass lock and reissue on contention; avoid KIS rate-limit storms.
  throw new Error("KIS_SHARED_CACHE_LOCK_TIMEOUT_MANUAL_INSPECTION_REQUIRED");
}
