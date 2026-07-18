import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryRule, ResolvedConfig } from "../../shared/types";
import { DiscoveryService } from "./discovery";

// The `worktrees` discovery rule shells out to `git ... worktree list --porcelain`.
// We mock only that boundary — `execFile` from node:child_process — and drive the
// real parser with synthetic porcelain output. Everything else (directory scans,
// globs, failure tolerance) runs against real temp fixture trees, no mocks.
const gitBoundary = vi.hoisted(() => ({
  stdout: "",
  error: undefined as Error | undefined,
  calls: [] as Array<{ command: string; args: string[] }>
}));

vi.mock("node:child_process", () => {
  const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
  const execFile = () => {
    throw new Error("callback-style execFile is not used by discovery");
  };
  (execFile as unknown as Record<symbol, unknown>)[promisifyCustom] = (
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> => {
    gitBoundary.calls.push({ command, args });
    if (gitBoundary.error) {
      return Promise.reject(gitBoundary.error);
    }
    return Promise.resolve({ stdout: gitBoundary.stdout, stderr: "" });
  };
  return { execFile };
});

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "arcane-discovery-"));
  gitBoundary.stdout = "";
  gitBoundary.error = undefined;
  gitBoundary.calls = [];
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// A ResolvedConfig carrying only the fields discovery reads; the rest is irrelevant.
function configWith(discovery: DiscoveryRule[], projects: ResolvedConfig["projects"] = {}): ResolvedConfig {
  return { projects, discovery } as unknown as ResolvedConfig;
}

function mkdirs(...dirs: string[]): void {
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

describe("DiscoveryService — directory scan", () => {
  it("discovers directories carrying the marker and skips unmarked and excluded ones", async () => {
    // Fixture derived by hand: alpha (depth 1) and gamma (depth 2, under nested)
    // both carry .git; beta has no marker; node_modules is excluded by name.
    mkdirs(
      path.join(tmpRoot, "alpha", ".git"),
      path.join(tmpRoot, "beta"),
      path.join(tmpRoot, "node_modules", ".git"),
      path.join(tmpRoot, "nested", "gamma", ".git")
    );

    const rule: DiscoveryRule = {
      name: "code",
      type: "directories",
      path: tmpRoot,
      match: ".git",
      exclude: ["node_modules"],
      maxDepth: 2
    };

    const result = await new DiscoveryService().discover(configWith([rule]));

    expect(new Set(Object.keys(result.projects))).toEqual(new Set(["alpha", "gamma"]));
    expect(result.projects.alpha).toEqual({
      path: path.join(tmpRoot, "alpha"),
      shortName: "alpha",
      label: "alpha",
      source: "discovered"
    });
    expect(result.projects.gamma).toEqual({
      path: path.join(tmpRoot, "nested", "gamma"),
      shortName: "gamma",
      label: "gamma",
      source: "discovered"
    });
    expect(result.warnings).toEqual([]);
  });

  it("does not descend past maxDepth", async () => {
    // gamma sits at depth 2; with maxDepth 1 the scan never reaches it.
    mkdirs(path.join(tmpRoot, "nested", "gamma", ".git"));

    const rule: DiscoveryRule = {
      name: "shallow",
      type: "directories",
      path: tmpRoot,
      match: ".git",
      maxDepth: 1
    };

    const result = await new DiscoveryService().discover(configWith([rule]));

    expect(result.projects).toEqual({});
  });

  it("treats every directory as a match when no marker is configured", async () => {
    mkdirs(path.join(tmpRoot, "one"), path.join(tmpRoot, "two"));

    const rule: DiscoveryRule = {
      name: "all-dirs",
      type: "directories",
      path: tmpRoot,
      maxDepth: 1
    };

    const result = await new DiscoveryService().discover(configWith([rule]));

    expect(new Set(Object.keys(result.projects))).toEqual(new Set(["one", "two"]));
  });
});

describe("DiscoveryService — glob rule", () => {
  it("includes only directories matching the glob pattern", async () => {
    mkdirs(path.join(tmpRoot, "svc-one"), path.join(tmpRoot, "svc-two"));
    fs.writeFileSync(path.join(tmpRoot, "readme.txt"), "not a dir");

    const rule: DiscoveryRule = {
      name: "services",
      type: "glob",
      path: `${tmpRoot}/*`
    };

    const result = await new DiscoveryService().discover(configWith([rule]));

    expect(new Set(Object.keys(result.projects))).toEqual(new Set(["svc-one", "svc-two"]));
    expect(result.projects["svc-one"]).toEqual({
      path: path.join(tmpRoot, "svc-one"),
      shortName: "svc-one",
      label: "svc-one",
      source: "discovered"
    });
  });

  it("tolerates a glob base that does not exist (no matches, no warning)", async () => {
    const rule: DiscoveryRule = {
      name: "missing-glob",
      type: "glob",
      path: `${path.join(tmpRoot, "does-not-exist")}/*`
    };

    const result = await new DiscoveryService().discover(configWith([rule]));

    expect(result.projects).toEqual({});
    expect(result.warnings).toEqual([]);
  });
});

describe("DiscoveryService — worktree list parsing", () => {
  it("parses `git worktree list --porcelain` and ignores non-worktree lines", async () => {
    // Synthetic porcelain: main + a linked worktree + a bare entry. The parser
    // only reads `worktree ` lines, so HEAD/branch/bare lines must be ignored.
    const worktreeA = path.join(tmpRoot, "my-app");
    const worktreeB = path.join(tmpRoot, "my-app-feature");
    gitBoundary.stdout = [
      `worktree ${worktreeA}`,
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      `worktree ${worktreeB}`,
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feature",
      "",
      "worktree /tmp/should-still-parse-bare",
      "bare",
      ""
    ].join("\n");

    const rule: DiscoveryRule = {
      name: "app-worktrees",
      type: "worktrees",
      path: worktreeA
    };

    const result = await new DiscoveryService().discover(configWith([rule]));

    // The shell-out boundary was invoked with the porcelain contract.
    expect(gitBoundary.calls).toHaveLength(1);
    expect(gitBoundary.calls[0]).toEqual({
      command: "git",
      args: ["-C", worktreeA, "worktree", "list", "--porcelain"]
    });

    expect(new Set(Object.keys(result.projects))).toEqual(
      new Set(["my-app", "my-app-feature", "should-still-parse-bare"])
    );
    expect(result.projects["my-app"]).toEqual({
      path: worktreeA,
      shortName: "my-app",
      label: "my-app",
      source: "discovered"
    });
    expect(result.warnings).toEqual([]);
  });

  it("surfaces a warning (not a throw) when the git shell-out fails", async () => {
    gitBoundary.error = new Error("fatal: not a git repository");

    const rule: DiscoveryRule = {
      name: "broken-worktrees",
      type: "worktrees",
      path: path.join(tmpRoot, "not-a-repo")
    };

    const result = await new DiscoveryService().discover(configWith([rule]));

    expect(result.projects).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(rule.name);
  });
});

describe("DiscoveryService — dedupe and identity collisions", () => {
  it("skips paths already present in configured projects", async () => {
    const existing = path.join(tmpRoot, "existing");
    mkdirs(path.join(existing, ".git"), path.join(tmpRoot, "fresh", ".git"));

    const rule: DiscoveryRule = {
      name: "code",
      type: "directories",
      path: tmpRoot,
      match: ".git",
      maxDepth: 1
    };

    const result = await new DiscoveryService().discover(
      configWith([rule], {
        existing: { path: existing, shortName: "ex" }
      })
    );

    // The configured path is not re-emitted; only the new directory is.
    expect(Object.keys(result.projects)).toEqual(["fresh"]);
  });

  it("suffixes the project id when the slug collides with a configured project id", async () => {
    // A configured project already owns the id "app" at a different path, so the
    // discovered ./app directory must fall back to "app-2".
    mkdirs(path.join(tmpRoot, "app", ".git"));

    const rule: DiscoveryRule = {
      name: "code",
      type: "directories",
      path: tmpRoot,
      match: ".git",
      maxDepth: 1
    };

    const result = await new DiscoveryService().discover(
      configWith([rule], {
        app: { path: path.join(os.tmpdir(), "some-other-app"), shortName: "app" }
      })
    );

    expect(Object.keys(result.projects)).toEqual(["app-2"]);
    expect(result.projects["app-2"]).toEqual({
      path: path.join(tmpRoot, "app"),
      shortName: "app",
      label: "app",
      source: "discovered"
    });
  });

  it("tolerates a non-existent directory root by warning instead of throwing", async () => {
    const rule: DiscoveryRule = {
      name: "ghost",
      type: "directories",
      path: path.join(tmpRoot, "nowhere"),
      match: ".git"
    };

    const result = await new DiscoveryService().discover(configWith([rule]));

    expect(result.projects).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(rule.name);
  });
});
