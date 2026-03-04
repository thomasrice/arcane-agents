import { describe, expect, it } from "vitest";
import { hasSessionIdArg, looksLikeClaudeRuntime, withClaudeSessionId } from "./command";

describe("looksLikeClaudeRuntime", () => {
  it("matches runtime IDs or command binaries that look like claude", () => {
    expect(looksLikeClaudeRuntime("claude", ["bash"])).toBe(true);
    expect(looksLikeClaudeRuntime("assistant", ["/usr/local/bin/claude-code"])).toBe(true);
    expect(looksLikeClaudeRuntime("shell", ["bash"])).toBe(false);
  });
});

describe("hasSessionIdArg", () => {
  it("detects --session-id passed as separate or inline argument", () => {
    expect(hasSessionIdArg(["claude", "--session-id", "abc"])).toBe(true);
    expect(hasSessionIdArg(["claude", "--session-id=abc"])).toBe(true);
    expect(hasSessionIdArg(["claude", "--session-id"])).toBe(false);
    expect(hasSessionIdArg(["claude", "--session-id="])).toBe(false);
  });
});

describe("withClaudeSessionId", () => {
  it("returns an unchanged copy for non-claude commands", () => {
    const command = ["bash", "-lc", "ls"];
    const result = withClaudeSessionId("shell", command);

    expect(result).toEqual(command);
    expect(result).not.toBe(command);
  });

  it("does not append a second session id when one already exists", () => {
    const command = ["claude", "--session-id", "existing"];
    const result = withClaudeSessionId("claude", command);
    expect(result).toEqual(command);
  });

  it("appends a generated session id for claude commands missing one", () => {
    const result = withClaudeSessionId("claude", ["claude"]);
    const sessionId = result[2];

    expect(result[0]).toBe("claude");
    expect(result[1]).toBe("--session-id");
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
