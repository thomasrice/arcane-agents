import { describe, expect, it } from "vitest";
import { getAutomaticWorkVoiceLineEvents, resolveVoiceLineFileNames } from "./useWorkerVoiceLines";

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

describe("resolveVoiceLineFileNames", () => {
  const catalog = [
    "arrive.mp3",
    "arrive_variant_2.mp3",
    "arrive_variant_1.mp3",
    "attention.mp3",
    "Death_alt.MP3",
    "selected_variant_1.mp3",
    "notes.txt"
  ];

  it("collects every mp3 whose name starts with the event, for any event", () => {
    expect([...resolveVoiceLineFileNames(catalog, "arrive")].sort()).toEqual([
      "arrive.mp3",
      "arrive_variant_1.mp3",
      "arrive_variant_2.mp3"
    ]);
    expect(resolveVoiceLineFileNames(catalog, "death")).toEqual(["Death_alt.MP3"]);
    expect(resolveVoiceLineFileNames(catalog, "attention")).toEqual(["attention.mp3"]);
  });

  it("returns nothing for an event with no files, so the caller falls back to defaults", () => {
    expect(resolveVoiceLineFileNames(catalog, "complete")).toEqual([]);
    expect(resolveVoiceLineFileNames(catalog, "move")).toEqual([]);
  });
});
