import { describe, expect, it } from "vitest";
import { attachWords } from "./words";

const word = (start: number, end: number, text: string) => ({ start, end, text });
const WORDS = [word(0, 0.4, "Bonjour"), word(2, 2.5, "à"), word(2.6, 2.9, "tous."), word(3.05, 3.6, "Salut")];

describe("attachWords", () => {
  it("gives each cue the words that spell its text", () => {
    const cues = attachWords(
      [
        { id: 1, start: 0, end: 3, text: "Bonjour à\ntous." },
        { id: 2, start: 3, end: 4, text: "Salut" },
      ],
      WORDS,
    );

    expect(cues[0].words).toEqual(WORDS.slice(0, 3));
    expect(cues[1].words).toEqual(WORDS.slice(3));
  });

  it("leaves a corrected or translated cue without word times", () => {
    const cue = { id: 1, start: 0, end: 3, text: "Hello everyone" };

    expect(attachWords([cue], WORDS)[0]).toBe(cue);
  });

  it("changes nothing without word times", () => {
    const cues = [{ id: 1, start: 0, end: 3, text: "Bonjour" }];

    expect(attachWords(cues, [])).toBe(cues);
  });
});
