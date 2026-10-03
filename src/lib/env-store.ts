import fs from "node:fs";
import path from "node:path";

/**
 * Runtime overlay for credentials entered in Settings. Next.js only loads
 * `.env` at process start, so a form save has to both persist and update
 * `process.env` or Connect would stay dead until a restart.
 *
 * `data/app-env.json` is the live source. `.env` is patched so the values
 * survive a reboot and stay visible if you open the file.
 */

const STORE_PATH = path.join(process.cwd(), "data", "app-env.json");
const DOTENV_PATH = path.join(process.cwd(), ".env");

function hydrateProcessEnv(): void {
  for (const [key, value] of Object.entries(loadStore())) {
    if (value.trim().length > 0) process.env[key] = value;
  }
}

hydrateProcessEnv();

export function getStoredEnv(name: string): string | undefined {
  const value = loadStore()[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function applyEnvUpdates(updates: Record<string, string | undefined>): void {
  const store = loadStore();
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      delete store[key];
      // Do not delete process.env / .env keys that were already there unless
      // the user explicitly cleared the field and we were asked to.
      continue;
    }
    store[key] = trimmed;
    process.env[key] = trimmed;
  }
  persistStore(store);
  patchDotenv(store);
}

function loadStore(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function persistStore(store: Record<string, string>): void {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function patchDotenv(store: Record<string, string>): void {
  let text = "";
  try {
    text = fs.readFileSync(DOTENV_PATH, "utf8");
  } catch {
    text = "";
  }

  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  const seen = new Set<string>();

  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return line;
    const key = match[1];
    if (!(key in store)) return line;
    seen.add(key);
    return `${key}=${quoteEnv(store[key])}`;
  });

  for (const [key, value] of Object.entries(store)) {
    if (seen.has(key)) continue;
    next.push(`${key}=${quoteEnv(value)}`);
  }

  fs.writeFileSync(DOTENV_PATH, `${next.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

function quoteEnv(value: string): string {
  if (/[\s#"']/.test(value)) return JSON.stringify(value);
  return value;
}

for (const [key, value] of Object.entries(loadStore())) {
  if (value.trim().length > 0) process.env[key] = value;
}
