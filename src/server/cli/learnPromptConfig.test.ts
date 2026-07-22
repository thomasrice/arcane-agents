import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendPromptSignature, type PromptSignatureFileSystem } from "./learnPromptConfig";

const tempDirectories: string[] = [];
const signature = { id: "claude-worker-prompt", runtime: "claude" as const, all: ["^\\s*❯", "\\?\\s+for"] };

async function localConfig(contents: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "arcane-learn-prompt-"));
  tempDirectories.push(directory);
  const filePath = path.join(directory, "config.local.yaml");
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("appendPromptSignature", () => {
  it("appends beneath status while preserving unrelated comments and nodes", async () => {
    const filePath = await localConfig("# keep this comment\naudio:\n  enableSound: false\nstatus:\n  # keep this too\n  extraInteractiveCommands:\n    - vim\n");

    await fs.chmod(filePath, 0o640);
    await appendPromptSignature(filePath, signature);

    const written = await fs.readFile(filePath, "utf8");
    expect(written).toContain("# keep this comment");
    expect(written).toContain("# keep this too");
    expect(written).toContain("audio:");
    expect(written).toContain("extraPromptSignatures:");
    expect(written).toContain("id: claude-worker-prompt");
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o640);
  });

  it("rejects a duplicate local extra without changing bytes", async () => {
    const original = "status:\n  extraPromptSignatures:\n    - id: claude-worker-prompt\n      runtime: claude\n      all: [a, b]\n";
    const filePath = await localConfig(original);

    await expect(appendPromptSignature(filePath, signature)).rejects.toThrow("already exists");
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe(original);
  });

  it("removes the temporary file when atomic replacement fails", async () => {
    let writtenPath: string | undefined;
    let unlinkedPath: string | undefined;
    const fileSystem: PromptSignatureFileSystem = {
      readFile: async () => "audio:\n  enableSound: false\n",
      writeFile: async (filePath) => {
        writtenPath = filePath;
      },
      rename: async () => {
        throw new Error("rename failed");
      },
      unlink: async (filePath) => {
        unlinkedPath = filePath;
      },
      stat: async () => ({ mode: 0o640 }),
      chmod: async () => undefined
    };

    await expect(appendPromptSignature("/config/config.local.yaml", signature, fileSystem)).rejects.toThrow(
      "rename failed"
    );
    expect(unlinkedPath).toBe(writtenPath);
  });
});
