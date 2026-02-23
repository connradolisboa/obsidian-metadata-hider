# Fix & Improvement Checklist

All issues are in `main.ts` unless noted. Build with `npm run build` after changes, then copy artifacts to your test vault.

---

## Fix 1 — Obsidian Bases: empty-property CSS bleeds into Bases filter UI

**Root cause:** The `hideEmptyEntry` block in `genAllCSS()` emits unscoped selectors like
`.metadata-property:has(...)`. Obsidian Bases reuses elements with that class for its filter/column UI,
so those get hidden as well. The entry-based CSS is already correctly scoped via
`.metadata-container > .metadata-content > .metadata-properties > .metadata-property`
but `hideEmptyEntry` does not use that scope.

**Where:** `genAllCSS()`, lines ~213–219.

**Fix:** Prepend `.metadata-container` to every selector in the `hideEmptyEntry` block so
that the rules only fire inside the actual property table container, not in Bases.

Change each rule from:
```css
.metadata-property:has(...)
```
to:
```css
.metadata-container .metadata-property:has(...)
```

Also update the `is-active` show-all rule and the side-dock override to stay consistent.

- [ ] Scope all `hideEmptyEntry` selectors to `.metadata-container`
- [ ] Re-test: Bases filter placeholder is no longer hidden
- [ ] Re-test: Normal property table still hides empty entries

---

## Fix 2 — CamelCase / PascalCase entry names silently not hidden (CSS)

**Root cause:** Obsidian normalizes property keys to **lowercase** in the `data-property-key`
DOM attribute (e.g. frontmatter `myProp:` → `data-property-key="myprop"`). `genCSS()` embeds the
entry name exactly as the user typed it, producing `.metadata-property[data-property-key="myProp"]`
which never matches `data-property-key="myprop"` because CSS attribute selectors are case-sensitive.

**Where:** `genCSS()`, line ~200. Also affects `propertyHideAll` in `genAllCSS()`, line ~230.

**Fix (option A — recommended):** Normalize property names to lowercase before embedding them
in CSS attribute selectors. Change `escapeCSSAttrValue(property.trim())` to
`escapeCSSAttrValue(property.trim().toLowerCase())` everywhere a key is used in
`[data-property-key="..."]`. Do the same for `propertyHideAll`.

**Fix (option B — alternative):** Use the case-insensitive attribute selector flag `[... i]`:
`.metadata-property[data-property-key="myProp" i]`. Simpler change, but wider match surface.

- [ ] Normalize to `.toLowerCase()` in `genCSS()` when building the `data-property-key` selector
- [ ] Normalize to `.toLowerCase()` in `genAllCSS()` for the `propertyHideAll` selector
- [ ] Re-test: a property named `MyTag` or `camelCase` is now correctly hidden

---

## Fix 3 — CamelCase / PascalCase not hidden in all-properties panel (JS)

**Root cause:** `hideInAllProperties()` compares `inner.textContent` against the stored entry name
with a strict `.includes()`. If Obsidian displays the key differently in the tree (formatted,
lowercased, or trimmed with a trailing newline), the comparison fails silently.

**Where:** `hideInAllProperties()`, line ~55.

**Fix:** Check `data-property-key` attribute on the `.tree-item` element first (Obsidian sets this
in most views), then fall back to `textContent` with a normalized comparison. Also trim
whitespace from `textContent` to avoid invisible-character mismatches.

```typescript
const key = (item as HTMLElement).dataset?.propertyKey
  ?? inner?.textContent?.trim()
  ?? '';
const normalizedKey = key.toLowerCase();
const match = propertiesInvisible.some(name => name.toLowerCase() === normalizedKey);
if (match) {
  item.classList.add('mh-hide');
} else {
  item.classList.remove('mh-hide');
}
```

- [ ] Replace the `inner.textContent` comparison with `data-property-key`-first + case-normalized comparison
- [ ] Re-test: a `PascalCase` or `camelCase` property is now hidden in the all-properties panel

---

## Fix 4 — Checkbox properties not detected as empty (hideEmptyEntry)

**Root cause:** The `hideEmptyEntry` CSS block has no rule for unchecked checkbox properties.
An unchecked checkbox renders with `data-property-type="checkbox"` and
`input[type="checkbox"]:not(:checked)` but none of the existing empty-detection selectors cover it.

**Where:** `genAllCSS()`, hideEmptyEntry block (~lines 213–219).

**Fix:** Add a selector for unchecked checkboxes inside the `.metadata-container` scope:

```css
.metadata-container .metadata-property[data-property-type="checkbox"]:has(input[type="checkbox"]:not(:checked)) {
  display: none;
}
```

Note: This hides any checkbox property whose value is `false` (unchecked). If that is
not the desired behavior, it could be gated behind a separate setting.

- [ ] Add the unchecked-checkbox selector to the `hideEmptyEntry` block
- [ ] Verify the selector is also excluded from the Bases-scoping issue fixed in Fix 1
- [ ] Re-test: a checkbox property set to `false` is hidden; one set to `true` remains visible

---

## Fix 5 — Number properties not detected as empty (hideEmptyEntry)

**Root cause:** The current selector
`.metadata-property:has(.metadata-property-value input.metadata-input[type="number"]:placeholder-shown)`
depends on Obsidian setting a `placeholder` attribute on numeric inputs. If no placeholder is set,
`:placeholder-shown` never fires. Additionally, the selector is unscoped (same Bases bleed as Fix 1).

**Where:** `genAllCSS()`, hideEmptyEntry block (~line 215).

**Investigation needed:** Open DevTools in Obsidian (`Ctrl+Shift+I`), inspect an empty
number property, and check whether the `<input>` has a `placeholder` attribute.

**Likely fix:**
- If Obsidian sets `placeholder`, the rule works once scoped to `.metadata-container` (Fix 1).
- If Obsidian does **not** set `placeholder`, replace with a `[data-property-type="number"]`
  approach or check for a specific empty-state class Obsidian applies.

A candidate selector that does not rely on `placeholder`:
```css
.metadata-container .metadata-property[data-property-type="number"]:has(input.metadata-input:not([value]):not(:focus))
```
or check if Obsidian adds an `is-empty` class on the property row.

- [ ] Inspect Obsidian DOM for an empty number property field to confirm actual structure
- [ ] Update the number-empty selector to be reliable and scoped to `.metadata-container`
- [ ] Re-test: an empty number property is hidden; a number property with value `0` or positive stays visible

---

## Final checks

- [ ] Run `npm run build` with no TypeScript errors
- [ ] Test in a real vault: empty text / date / multi-select properties still hidden
- [ ] Test in a real vault: Bases view filter placeholder is **not** hidden
- [ ] Test in a real vault: `camelCase`, `PascalCase`, and `lowercase` entry names all hide correctly
- [ ] Test in a real vault: unchecked checkbox property is hidden; checked one is visible
- [ ] Test in a real vault: all-properties panel hides the right entries regardless of key casing
- [ ] Bump version if releasing (`npm run version`)
