import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HistoryPanel from "./HistoryPanel";

describe("HistoryPanel", () => {
  it("lists the steps, marks the current one and greys the undone ones", () => {
    render(<HistoryPanel labels={["Opened", "Crop", "Speed"]} current={1} onGoto={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "History" })).toBeInTheDocument();
    const current = screen.getByRole("button", { name: "Crop" });
    expect(current).toHaveAttribute("aria-current", "step");
    expect(current).toBeDisabled();
    expect(screen.getByRole("button", { name: "Speed" })).toHaveClass("undone");
    expect(screen.getByRole("button", { name: "Opened" })).not.toHaveClass("undone");
  });

  it("jumps to the clicked step and closes", () => {
    const onGoto = vi.fn();
    const onClose = vi.fn();
    render(<HistoryPanel labels={["Opened", "Crop"]} current={1} onGoto={onGoto} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Opened" }));
    expect(onGoto).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Close the history" }));
    expect(onClose).toHaveBeenCalled();
  });
});
