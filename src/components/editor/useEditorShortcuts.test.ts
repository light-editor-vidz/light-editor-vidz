import { afterEach, describe, expect, it } from "vitest";
import { isModalOpen, isTyping } from "./useEditorShortcuts";

const input = (type: string) => Object.assign(document.createElement("input"), { type });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isTyping", () => {
  it("keeps the keyboard for text fields, selects and text areas", () => {
    expect(isTyping(input("text"), " ")).toBe(true);
    expect(isTyping(input("number"), "Delete")).toBe(true);
    expect(isTyping(document.createElement("textarea"), "a")).toBe(true);
    expect(isTyping(document.createElement("select"), " ")).toBe(true);
  });

  it("lets Space, Delete and Ctrl+Z through after a checkbox, a button or a colour input", () => {
    for (const type of ["checkbox", "radio", "button", "color"]) expect(isTyping(input(type), " ")).toBe(false);
    expect(isTyping(null, " ")).toBe(false);
    expect(isTyping(document.createElement("div"), " ")).toBe(false);
  });

  it("leaves a slider its arrow keys only", () => {
    const slider = input("range");
    expect(isTyping(slider, "ArrowLeft")).toBe(true);
    expect(isTyping(slider, "Home")).toBe(true);
    expect(isTyping(slider, " ")).toBe(false);
    expect(isTyping(slider, "Delete")).toBe(false);
  });
});

describe("isModalOpen", () => {
  it("sees a visible modal, not one inside a hidden tab", () => {
    expect(isModalOpen()).toBe(false);
    const hidden = document.body.appendChild(document.createElement("div"));
    hidden.hidden = true;
    hidden.innerHTML = '<div class="modal-backdrop"></div>';
    expect(isModalOpen()).toBe(false);

    document.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="true"></div>');
    expect(isModalOpen()).toBe(true);
  });
});
