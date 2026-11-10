import "./setup";
import { describe, it, expect } from "vitest";
import { parseSrt } from "../utils/srt";

describe("parseSrt", () => {
  it("parses a well-formed SRT file", () => {
    const content = `1
00:00:00,000 --> 00:00:02,680
Le Dôme sélectionne quotidiennement les meilleures poissons français.

2
00:00:02,680 --> 00:00:03,880
Dégennés d'affaires.

3
00:00:03,880 --> 00:00:06,000
Et repas familiaux y trouvent leur excellence.
`;
    const cues = parseSrt(content);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({
      id: 1,
      start: 0,
      end: 2.68,
      text: "Le Dôme sélectionne quotidiennement les meilleures poissons français.",
    });
    expect(cues[1].start).toBeCloseTo(2.68);
    expect(cues[1].end).toBeCloseTo(3.88);
    expect(cues[2].text).toBe("Et repas familiaux y trouvent leur excellence.");
  });

  it("handles CRLF line endings", () => {
    const content =
      "1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nWorld\r\n";
    const cues = parseSrt(content);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("Hello");
    expect(cues[1].text).toBe("World");
  });

  it("joins multi-line cue text with newlines", () => {
    const content = "1\n00:00:00,000 --> 00:00:02,000\nLine one\nLine two\n";
    const cues = parseSrt(content);
    expect(cues[0].text).toBe("Line one\nLine two");
  });

  it("skips blocks without a valid timestamp line", () => {
    const content = "1\n00:00:00,000 --> 00:00:02,000\nGood cue\n\ngarbage block\nno timestamp here\n";
    const cues = parseSrt(content);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Good cue");
  });

  it("skips cues with no text or non-positive duration", () => {
    const content = "1\n00:00:00,000 --> 00:00:02,000\n\n\n2\n00:00:05,000 --> 00:00:05,000\nZero duration\n";
    expect(parseSrt(content)).toHaveLength(0);
  });

  it("returns an empty array for empty input", () => {
    expect(parseSrt("")).toEqual([]);
  });

  it("sorts cues by start time", () => {
    const content = "1\n00:00:05,000 --> 00:00:06,000\nSecond\n\n2\n00:00:00,000 --> 00:00:01,000\nFirst\n";
    const cues = parseSrt(content);
    expect(cues.map((c) => c.text)).toEqual(["First", "Second"]);
  });
});

describe("parseSrt — markup", () => {
  const block = (text: string) => `1\n00:00:00,000 --> 00:00:02,000\n${text}\n`;

  it("strips <i>, <b>, <u> and <font> tags", () => {
    expect(parseSrt(block('<i>hello</i> <b>brave</b> <font color="#ff0000">world</font>'))[0].text).toBe(
      "hello brave world",
    );
  });

  it("strips ASS-style override tags such as {\\an8}", () => {
    expect(parseSrt(block("{\\an8}On top"))[0].text).toBe("On top");
  });

  it("keeps a lone < or > that is not a tag", () => {
    expect(parseSrt(block("1 < 2 and 3 > 2"))[0].text).toBe("1 < 2 and 3 > 2");
  });

  it("drops a cue that is nothing but markup", () => {
    expect(parseSrt(block("<i></i>"))).toEqual([]);
  });
});
