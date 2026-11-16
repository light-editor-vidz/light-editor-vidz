import "./setup";
import { describe, it, expect } from "vitest";
import { moveItem } from "../utils/sequences";

describe("moveItem", () => {
  it("moves an item to another position", () => {
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("does nothing when the move is a no-op or out of range", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 0, 0)).toBe(list);
    expect(moveItem(list, 0, 2)).toBe(list);
    expect(moveItem(list, 5, 0)).toBe(list);
  });

  it("does not modify the original list", () => {
    const list = ["a", "b", "c"];
    moveItem(list, 0, 2);
    expect(list).toEqual(["a", "b", "c"]);
  });
});
