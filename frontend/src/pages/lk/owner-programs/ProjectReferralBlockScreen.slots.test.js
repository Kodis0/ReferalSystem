import {
  shouldShowSlotAfter,
  shouldShowSlotBefore,
  collectInsertionSlotIdsInOrder,
  blockGroupId,
  blockIsContinuation,
} from "./ProjectReferralBlockScreen";

describe("screenshot insertion slot rules", () => {
  test("blocks with same group_id do not get slot between them", () => {
    const a = { id: "a1", group_id: "g1", allow_insert_after: null };
    const b = { id: "a2", group_id: "g1", is_continuation: true, allow_insert_before: null };
    expect(shouldShowSlotAfter(a, b)).toBe(false);
  });

  test("allow_insert_after false hides slot", () => {
    const a = { id: "x", group_id: "g1", allow_insert_after: false };
    const b = { id: "y", group_id: "g2" };
    expect(shouldShowSlotAfter(a, b)).toBe(false);
  });

  test("different group_id gets slot with fallback", () => {
    const a = { id: "x", group_id: "g1", allow_insert_after: null };
    const b = { id: "y", group_id: "g2", is_continuation: false };
    expect(shouldShowSlotAfter(a, b)).toBe(true);
  });

  test("next continuation hides slot after previous", () => {
    const a = { id: "x", group_id: "g1", allow_insert_after: true };
    const b = { id: "y", group_id: "g2", is_continuation: true };
    expect(shouldShowSlotAfter(a, b)).toBe(false);
  });

  test("continuation block never shows slot before", () => {
    const prev = { id: "p", group_id: "g1" };
    const cur = { id: "c", group_id: "g1", is_continuation: true, allow_insert_before: null };
    expect(shouldShowSlotBefore(cur, prev, false, 1)).toBe(false);
  });

  test("collectInsertionSlotIdsInOrder uses after ids between groups", () => {
    const blocks = [
      { id: "h", kind: "header", group_id: "hdr", allow_insert_after: true },
      { id: "m1", kind: "first_screen", group_id: "ga", allow_insert_after: true },
      { id: "m2", kind: "section", group_id: "gb", allow_insert_after: true },
    ];
    const ids = collectInsertionSlotIdsInOrder(blocks);
    expect(ids.some((id) => id === "after-hdr")).toBe(true);
    expect(ids.filter((id) => id === "after-ga").length).toBe(1);
  });

  test("blockGroupId falls back to id", () => {
    expect(blockGroupId({ id: "rec1" })).toBe("rec1");
  });

  test("blockIsContinuation reads snake_case", () => {
    expect(blockIsContinuation({ is_continuation: true })).toBe(true);
  });
});
