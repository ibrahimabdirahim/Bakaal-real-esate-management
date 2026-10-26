import { describe, expect, it } from "vitest";
import { paginate, queryWithoutPage } from "@/lib/paginate";

describe("paginate", () => {
  const items = Array.from({ length: 53 }, (_, i) => i);

  it("returns the requested page and page count", () => {
    const p = paginate(items, "2", 25);
    expect(p).toMatchObject({ page: 2, pages: 3, total: 53 });
    expect(p.items[0]).toBe(25);
    expect(p.items).toHaveLength(25);
  });

  it("clamps out-of-range and invalid page numbers", () => {
    expect(paginate(items, "99", 25).page).toBe(3);
    expect(paginate(items, "-4", 25).page).toBe(1);
    expect(paginate(items, "abc", 25).page).toBe(1);
    expect(paginate([], "1").pages).toBe(1);
  });

  it("keeps filters but drops the page number for links", () => {
    expect(queryWithoutPage({ status: "OPEN", page: "3", q: "", tags: ["a"] })).toEqual({ status: "OPEN" });
  });
});
