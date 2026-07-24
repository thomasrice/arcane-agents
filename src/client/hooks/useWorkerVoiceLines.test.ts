import { describe, expect, it } from "vitest";
import { getAutomaticWorkVoiceLineEvents } from "./useWorkerVoiceLines";

const nowMs = Date.parse("2026-07-20T00:00:00.000Z");
const establishedCharacter = {
  createdAt: new Date(nowMs - 60_000).toISOString(),
  silenced: false
};

describe("getAutomaticWorkVoiceLineEvents", () => {
  it("announces attention and completion transitions for audible characters", () => {
    expect(
      getAutomaticWorkVoiceLineEvents(
        { status: "idle" },
        { ...establishedCharacter, status: "attention" },
        nowMs
      )
    ).toEqual(["attention"]);
    expect(
      getAutomaticWorkVoiceLineEvents(
        { status: "working" },
        { ...establishedCharacter, status: "idle" },
        nowMs
      )
    ).toEqual(["complete"]);
  });

  it("suppresses automatic attention and completion voice lines for silenced characters", () => {
    expect(
      getAutomaticWorkVoiceLineEvents(
        { status: "idle" },
        { ...establishedCharacter, status: "attention", silenced: true },
        nowMs
      )
    ).toEqual([]);
    expect(
      getAutomaticWorkVoiceLineEvents(
        { status: "working" },
        { ...establishedCharacter, status: "idle", silenced: true },
        nowMs
      )
    ).toEqual([]);
  });
});
