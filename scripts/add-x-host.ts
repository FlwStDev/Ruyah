import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Maps postforge.test -> 127.0.0.1 so the X developer console can have a
 * hostname that is not "localhost" and not an IP. Their settings form rejects
 * both of those with "Not a valid URL format".
 *
 * Run once (Administrator on Windows):
 *   pnpm x-host
 */

const HOST = "postforge.test";
const LINE = `127.0.0.1 ${HOST}`;

function hostsPath(): string {
  if (os.platform() === "win32") {
    return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "drivers", "etc", "hosts");
  }
  return "/etc/hosts";
}

function main() {
  const file = hostsPath();
  const current = fs.readFileSync(file, "utf8");
  if (current.split(/\r?\n/).some((line) => line.includes(HOST) && !line.trim().startsWith("#"))) {
    console.log(`${HOST} is already in ${file}`);
    return;
  }
  const suffix = current.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(file, `${suffix}${LINE}\n`);
  console.log(`Added: ${LINE}`);
  console.log(`File: ${file}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Could not edit the hosts file: ${message}`);
  console.error("");
  console.error("Run this terminal as Administrator, then: pnpm x-host");
  console.error("");
  console.error("Or add this line yourself:");
  console.error(`  ${LINE}`);
  console.error(`  Windows: ${path.join("C:\\Windows", "System32", "drivers", "etc", "hosts")}`);
  process.exitCode = 1;
}
