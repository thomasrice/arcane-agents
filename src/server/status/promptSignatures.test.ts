import { describe, expect, it } from "vitest";
import { compilePromptSignatures, matchPromptSignature, normalizePromptSignatureLines } from "./promptSignatures";

describe("prompt signatures", () => {
  it("requires every pattern to match a normalized current-screen line", () => {
    const signatures = compilePromptSignatures([
      {
        id: "custom-codex",
        runtime: "codex",
        all: ["^›", "^gpt-5\\.6 · ~/code$"]
      }
    ]);
    const output = ["\u001b[32m›   ask anything\u001b[0m", "", "gpt-5.6   ·   ~/code"].join("\n");

    expect(matchPromptSignature(signatures, output)).toEqual({ id: "custom-codex", runtime: "codex" });
    expect(matchPromptSignature(signatures, "› ask anything\nmodel footer missing")).toBeUndefined();
  });

  it("uses configuration order when more than one signature matches", () => {
    const signatures = compilePromptSignatures([
      { id: "first", runtime: "omp", all: ["^\\+", "context"] },
      { id: "second", runtime: "codex", all: ["^\\+", "context"] }
    ]);

    expect(matchPromptSignature(signatures, "+ prompt\ncontext 82%")).toEqual({ id: "first", runtime: "omp" });
  });

  it("preserves anchors while removing terminal controls and layout whitespace", () => {
    expect(normalizePromptSignatureLines("\u001b[2K  ›    prompt  \n\n model   ·   /tmp ")).toEqual([
      "› prompt",
      "model · /tmp"
    ]);
  });
});
