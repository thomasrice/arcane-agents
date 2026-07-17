import { describe, expect, it } from "vitest";
import { clipboardCandidatesForEnvironment } from "./clipboard";

describe("clipboardCandidatesForEnvironment", () => {
  it("prefers the Windows clipboard bridge when running inside WSL", () => {
    expect(clipboardCandidatesForEnvironment("linux", { WSL_DISTRO_NAME: "Ubuntu" })[0]).toEqual({
      binary: "clip.exe",
      command: "clip.exe"
    });
  });

  it("keeps native Linux clipboard commands first outside WSL", () => {
    expect(clipboardCandidatesForEnvironment("linux", {})[0]).toEqual({
      binary: "wl-copy",
      command: "wl-copy"
    });
  });
});
