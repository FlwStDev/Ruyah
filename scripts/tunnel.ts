import { spawn } from "node:child_process";
import { applyEnvUpdates } from "../src/lib/env-store";

/**
 * Opens a Cloudflare quick tunnel to this machine and writes the public
 * HTTPS origin into X_REDIRECT_URI / PUBLIC_BASE_URL so the X console can
 * save a real https URL (it rejects localhost and most http hosts).
 *
 * Keep this process running while you Connect X.
 */

const origin = process.env.TUNNEL_ORIGIN ?? "http://127.0.0.1:3000";
const child = spawn("cloudflared", ["tunnel", "--url", origin], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let published = false;

function publish(url: string) {
  if (published) return;
  published = true;
  const base = url.replace(/\/+$/, "");
  const redirect = `${base}/api/oauth/x/callback`;
  applyEnvUpdates({
    PUBLIC_BASE_URL: base,
    X_REDIRECT_URI: redirect,
  });
  console.log("");
  console.log("Paste these into console.x.com → User authentication settings:");
  console.log(`  Website URL:  ${base}`);
  console.log(`  Callback URI: ${redirect}`);
  console.log("");
  console.log("Then in Ruyah: Save X (redirect is already updated) → Connect X.");
  console.log("Leave this window open while you connect.");
}

function scan(chunk: Buffer) {
  const text = chunk.toString();
  process.stderr.write(text);
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match) publish(match[0]);
}

child.stdout?.on("data", scan);
child.stderr?.on("data", scan);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
