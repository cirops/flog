import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  HOOK_END_MARKER,
  HOOK_START_MARKER,
  installHooks,
  renderWrapperScript,
  uninstallHooks,
  wrappersPath
} from "../src/captures/hooks.js";

let configDir: string;
let rcPath: string;

beforeEach(async () => {
  configDir = await mkdtemp(path.join(os.tmpdir(), "flog-hooks-config-"));
  rcPath = path.join(configDir, ".zshrc");
  await writeFile(rcPath, "# existing rc\n", "utf8");
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

describe("renderWrapperScript", () => {
  it("emits command <root> and best-effort flog capture for each root", () => {
    const script = renderWrapperScript(["git", "t14ss"], "/opt/flog/dist/cli.js");
    assert.match(script, /command git "\$@"/);
    assert.match(script, /command t14ss "\$@"/);
    assert.match(script, /\/opt\/flog\/dist\/cli\.js' capture -- git "\$@"/);
    assert.match(script, /capture -- t14ss "\$@"/);
    assert.match(script, /\|\| true/);
  });
});

describe("installHooks / uninstallHooks", () => {
  it("writes wrappers and a marked rc block; second install stays idempotent", async () => {
    const first = await installHooks({
      rcPath,
      configDir,
      flogBin: "/usr/bin/flog"
    });
    assert.equal(first.rcPath, rcPath);

    const wrappers = await readFile(wrappersPath(configDir), "utf8");
    assert.match(wrappers, /command git "\$@"/);

    const rc1 = await readFile(rcPath, "utf8");
    assert.match(rc1, new RegExp(HOOK_START_MARKER));
    assert.match(rc1, new RegExp(HOOK_END_MARKER));
    assert.match(rc1, /source .*capture-wrappers\.sh/);
    assert.match(rc1, /# existing rc/);

    await installHooks({
      rcPath,
      configDir,
      flogBin: "/usr/bin/flog"
    });
    const rc2 = await readFile(rcPath, "utf8");
    assert.equal(countOccurrences(rc2, HOOK_START_MARKER), 1);
    assert.equal(countOccurrences(rc2, HOOK_END_MARKER), 1);
  });

  it("removes the marked block on uninstall", async () => {
    await installHooks({
      rcPath,
      configDir,
      flogBin: "/usr/bin/flog"
    });
    const result = await uninstallHooks({ rcPath });
    assert.equal(result.rcPath, rcPath);

    const rc = await readFile(rcPath, "utf8");
    assert.doesNotMatch(rc, new RegExp(HOOK_START_MARKER));
    assert.doesNotMatch(rc, new RegExp(HOOK_END_MARKER));
    assert.match(rc, /# existing rc/);
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
