import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));
export function retainedDirectory(label) {
  const directory = mkdtempSync(
    path.join(tmpdir(), `crustacean-map-${label}-`),
  );
  console.log(`Retained ${label} artifacts: ${directory}`);
  return directory;
}
export function run(
  command,
  args,
  { cwd = root, env = process.env, capture = false } = {},
) {
  const childEnv = { ...env },
    pathKey =
      Object.keys(childEnv).find((key) => key.toLowerCase() === "path") ||
      "PATH";
  childEnv[pathKey] =
    path.dirname(process.execPath) + path.delimiter + (childEnv[pathKey] || "");
  const result = spawnSync(command, args, {
    cwd,
    env: childEnv,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})${
        capture ? "\n" + result.stdout + "\n" + result.stderr : ""
      }`,
    );
  return result.stdout?.trim();
}
export function npm(args, options) {
  if (!process.env.npm_execpath)
    throw new Error("Run this validation through its npm script.");
  return run(process.execPath, [process.env.npm_execpath, ...args], options);
}
export function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix + entry.name;
      return entry.isDirectory()
        ? files(path.join(directory, entry.name), relative + "/")
        : [relative];
    })
    .sort();
}
export function packageJson() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
}
