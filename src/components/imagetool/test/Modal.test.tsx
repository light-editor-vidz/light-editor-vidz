import "./setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../ui/Modal";

function setup(onClose = vi.fn()) {
  render(
    <>
      <button>outside</button>
      <Modal title="Demo" onClose={onClose}>
        <input aria-label="first" />
        <button>middle</button>
        <button>last</button>
      </Modal>
    </>,
  );
  return onClose;
}

describe("Modal", () => {
  it("is exposed as a modal dialog with its title", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Demo" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("moves the focus inside when it opens", () => {
    setup();
    expect(screen.getByLabelText("first")).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const onClose = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click on the backdrop but not inside the panel", async () => {
    const onClose = setup();
    await userEvent.click(screen.getByText("middle"));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("dialog").parentElement as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("loops Tab from the last control back to the first, and Shift+Tab the other way", async () => {
    setup();
    screen.getByText("last").focus();

    await userEvent.tab();
    expect(screen.getByLabelText("first")).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(screen.getByText("last")).toHaveFocus();
  });

  it("gives the focus back to what had it before", () => {
    const { unmount } = render(<button>trigger</button>);
    screen.getByText("trigger").focus();
    const view = render(
      <Modal onClose={vi.fn()}>
        <button>in</button>
      </Modal>,
    );
    expect(screen.getByText("in")).toHaveFocus();

    view.unmount();

    expect(screen.getByText("trigger")).toHaveFocus();
    unmount();
  });
});
