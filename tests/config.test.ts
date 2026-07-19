import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAccounts, validateAccounts } from "../src/config.js";

async function withAccounts(accounts: unknown[], run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "wx-tool-accounts-"));
  try {
    await mkdir(path.join(rootDir, "config"), { recursive: true });
    await writeFile(path.join(rootDir, "config", "accounts.json"), JSON.stringify(accounts), "utf8");
    await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("loadAccounts accepts a unique account list", async () => {
  await withAccounts([{ name: "测试就业", fakeid: "MzA4NjAzMTIxNw==", alias: "test_career" }], async rootDir => {
    const accounts = await loadAccounts(rootDir);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].alias, "test_career");
  });
});

test("loadAccounts rejects duplicate names and fakeids", async () => {
  await withAccounts([
    { name: "重复账号", fakeid: "MzA4NjAzMTIxNw==" },
    { name: "重复账号", fakeid: "MzUyMjc4NjA4Nw==" },
  ], async rootDir => {
    await assert.rejects(loadAccounts(rootDir), /公众号名称重复/);
  });
  await withAccounts([
    { name: "账号甲", fakeid: "MzA4NjAzMTIxNw==" },
    { name: "账号乙", fakeid: "MzA4NjAzMTIxNw==" },
  ], async rootDir => {
    await assert.rejects(loadAccounts(rootDir), /fakeid 重复/);
  });
});

test("validateAccounts accepts an empty managed list but still validates duplicates", () => {
  assert.deepEqual(validateAccounts([], "D1", true), []);
  assert.throws(() => validateAccounts([], "D1"), /没有公众号配置/);
  assert.throws(() => validateAccounts([
    { name: "账号甲", fakeid: "MzA4NjAzMTIxNw==" },
    { name: "账号甲", fakeid: "MzUyMjc4NjA4Nw==" },
  ], "D1", true), /公众号名称重复/);
});
