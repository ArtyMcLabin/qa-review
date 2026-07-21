// @vitest-environment jsdom
//
// 4. SUB-HIGHLIGHT RENDER fixture: reproduces the invisible-highlight report.
// Root cause: mark.qar-subhl lives in PAGE content, OUTSIDE any .qar-theme
// scope, and the 0.3.0 rule depended on un-fallbacked scoped CSS vars - the
// declaration went invalid-at-computed-value and the mark rendered with no
// background at all. The 0.3.1 rule carries hard var() fallbacks.
import { describe, expect, it } from "vitest";
import { applySubHighlights } from "../src/client/highlight.js";
import { QA_STYLES } from "../src/client/styles.js";

function fixture(html: string): HTMLElement {
  const el = document.createElement("p");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("sub-highlight DOM rendering (fixture)", () => {
  it("wraps matching words in visible mark.qar-subhl elements", () => {
    const el = fixture("The nimble scout saw <b>quick foxes</b> and more quick foxes today.");
    const cleanup = applySubHighlights(el, ["quick foxes"]);
    const marks = el.querySelectorAll("mark.qar-subhl");
    expect(marks.length).toBe(2); // inside <b> and in the tail text
    for (const m of marks) expect(m.textContent?.toLowerCase()).toBe("quick foxes");
    // The rendered text is unchanged - marks only wrap, never rewrite.
    expect(el.textContent).toBe("The nimble scout saw quick foxes and more quick foxes today.");
    cleanup();
    expect(el.querySelectorAll("mark.qar-subhl").length).toBe(0);
    expect(el.textContent).toBe("The nimble scout saw quick foxes and more quick foxes today.");
    el.remove();
  });

  it("phrases with no match leave the DOM untouched", () => {
    const el = fixture("Nothing to see here.");
    const before = el.innerHTML;
    const cleanup = applySubHighlights(el, ["absent phrase"]);
    expect(el.innerHTML).toBe(before);
    cleanup();
    el.remove();
  });

  it("REGRESSION: the mark rule must not depend on scoped vars without fallbacks", () => {
    const markRule = QA_STYLES.split("mark.qar-subhl")[1]?.split("}")[0] ?? "";
    // Every var() reference inside the mark rule must carry a fallback value
    // (the mark is outside .qar-theme, where the vars are undefined).
    const varRefs = markRule.match(/var\(--[a-z-]+[^)]*\)/g) ?? [];
    expect(varRefs.length).toBeGreaterThan(0);
    for (const ref of varRefs) expect(ref).toContain(","); // var(--x, fallback)
    // And it must actually paint: background + box-shadow present.
    expect(markRule).toContain("background:");
    expect(markRule).toContain("box-shadow:");
  });
});
