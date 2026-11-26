import { describe, expect, it } from "vitest";
import { cutsFromSilences } from "../utils/silence";

const settings = { margin: 0.25, sentencesOnly: false };

describe("cutsFromSilences", () => {
  it("keeps a margin around the speech, but not at the ends of the file", () => {
    const silences = [
      { start: 0, end: 2 },
      { start: 5, end: 7 },
      { start: 9, end: 10 },
    ];

    expect(cutsFromSilences(silences, 10, settings)).toEqual([
      { start: 0, end: 1.75 },
      { start: 5.25, end: 6.75 },
      { start: 9.25, end: 10 },
    ]);
  });

  it("drops a cut too short to be worth a jump", () => {
    expect(cutsFromSilences([{ start: 3, end: 3.6 }], 10, settings)).toEqual([]);
  });

  it("never removes a spoken word, even when it is quiet", () => {
    const cues = [{ id: 1, start: 4, end: 6, text: "hm", words: [{ start: 4.5, end: 5, text: "hm" }] }];

    expect(cutsFromSilences([{ start: 3, end: 7 }], 10, settings, cues)).toEqual([
      { start: 3.25, end: 4.25 },
      { start: 5.25, end: 6.75 },
    ]);
  });

  it("can cut only after the end of a sentence", () => {
    const cues = [
      { id: 1, start: 0, end: 2, text: "Je pense que" },
      { id: 2, start: 4, end: 6, text: "c'est fini." },
      { id: 3, start: 8, end: 9, text: "Merci" },
    ];
    const silences = [
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ];

    expect(cutsFromSilences(silences, 10, { margin: 0.25, sentencesOnly: true }, cues)).toEqual([
      { start: 6.25, end: 7.75 },
    ]);
    expect(cutsFromSilences(silences, 10, settings, cues)).toHaveLength(2);
  });

  it("cuts nothing from a file that is silent from end to end", () => {
    expect(cutsFromSilences([{ start: 0, end: 10 }], 10, settings)).toEqual([]);
  });
});
