# Metadata Hider — Feature Roadmap

Reference this file across chat sessions to track planned and completed work.

---

## Current state (as of v1.0.2)

Already implemented:
- `folderFilter` + `tagFilter` per entry — hiding scoped to a folder or tag
- `isRegex` per entry — property name can be a JS regex pattern
- Global `autoFold` — folds metadata table on file open (all files)
- Global `propertiesVisible` — always-show list (all files)
- Import / Export settings JSON
- All four hide targets: tableInactive, tableActive, fileProperties, allProperties

Gaps addressed by this roadmap:
- Multiple rules for the same property are **blocked** by a UI duplicate-name check
- No first-match-wins priority: all applicable rules apply simultaneously
- No value-based conditions (`hide status when value == "Cancelled"`)
- `autoFold` is not scoped to folders or tags
- `propertiesVisible` is not scoped to folders or tags

---

## ✅ Phase 1 — Multiple rules + First-match-wins + Show action (completed v1.1.0)

**Goal:** Allow many rules for the same property; the rule highest in the list wins. Add a
per-rule `action` field so a rule can either hide or show a property.

### Data model changes

```typescript
// entrySettings gains one new field (backward-compat default: 'hide')
interface entrySettings {
  name: string;
  isRegex: boolean;
  folderFilter: string;
  tagFilter: string;
  action: 'hide' | 'show'; // NEW — default 'hide'
  hide: entryHideSettings;  // only meaningful when action === 'hide'
}
```

### Logic changes — `genAllCSS`

Replace the current "collect all applicable entries and emit CSS for each" approach with a
first-match-wins pass over the ordered entries array:

```
claimed = new Set<string>()
for each entry (non-regex, no valueCondition, applicable to current file):
  key = entry.name.toLowerCase()
  if key already in claimed → skip
  claimed.add(key)
  if entry.action === 'hide' → emit hide CSS for key
  if entry.action === 'show' → emit show CSS for key  (display: flex !important)
```

This means the first rule in the list whose folder/tag filter matches the open file determines
what happens to that property. Later rules for the same property are ignored for this file.

### Logic changes — `applyRegexHiding` (DOM path)

Same first-match-wins pass but per DOM element:
```
for each .metadata-property element in the container:
  for each entry in entries (in order):
    if matchesEntryName(key, entry) && isEntryApplicable(entry, file, app):
      apply hide or show class based on entry.action
      break  ← first match wins
```

### Settings UI changes

- Remove the duplicate-name validation that currently blocks same-name entries.
- Add a two-state button/toggle next to each entry labelled **Hide / Show** (action field).
- Entries can now represent "always-show in this context" rules by setting action=show, scoped
  with folderFilter/tagFilter — this replaces/extends the global `propertiesVisible` field.
- Reorder entries via drag handles (or Up/Down buttons) to control priority.

### Migration / backward compat

- `loadSettings` maps existing entries to `action: 'hide'` if the field is missing.
- Global `propertiesVisible` remains untouched; its entries are still appended last as
  unconditional show rules so they keep working for users who set them before this change.

---

## ✅ Phase 2 — Conditional value-based hiding (completed v1.2.0)

**Goal:** A rule optionally fires only when the property's current value matches a given
string (e.g., hide `status` only when its value is `"Cancelled"`).

### Data model changes

```typescript
interface entrySettings {
  // ... all Phase 1 fields
  valueCondition: string; // NEW — empty string means "any value" (existing behaviour)
}
```

### Reading property values

Use `app.metadataCache.getFileCache(file)?.frontmatter` instead of DOM scraping.
This is reliable regardless of property type (text, select, multiselect, number, etc.).

Comparison: `String(frontmatterValue).toLowerCase() === valueCondition.trim().toLowerCase()`

Support comma-separated values in `valueCondition` so a single rule can fire for multiple
values (e.g., `"Cancelled, Done"`).

### Triggering re-evaluation

- On `file-open` — already triggers `updateCSS`.
- On `metadata-cache-changed` — add this event listener to re-run hiding when the file is
  saved and the cache refreshes.
- On DOM `input` events inside `.metadata-container` — add a debounced listener for live
  feedback while the user is editing (reads DOM input value directly for responsiveness).

### CSS vs DOM path

Rules with a non-empty `valueCondition` must go through the DOM path (same as regex rules).
They cannot be expressed in static CSS since CSS does not see frontmatter values.

### Settings UI changes

- Add an optional text input per entry labelled **Value equals** (placeholder: `leave empty for any`).
- The input appears as a compact field; when empty the rule behaves as today.
- Hint text: "Comma-separate multiple values. Case-insensitive."

---

## ✅ Phase 3 — Auto-fold per folder / tag (completed v1.3.0)

**Goal:** Trigger metadata table auto-fold only for specific folders or tags rather than for
every file.

### Data model changes

```typescript
interface autoFoldRule {
  folderFilter: string;
  tagFilter: string;
}

interface MetadataHiderSettings {
  autoFold: boolean;           // unchanged — still a global default
  autoFoldRules: autoFoldRule[]; // NEW — additional scoped rules
  // ...
}
```

Fold fires on `file-open` if:
- `settings.autoFold === true` (existing global toggle), OR
- any `autoFoldRule` in `autoFoldRules` where `isEntryApplicable(rule, file, app)` is true.

### Settings UI changes

- Keep the existing global `autoFold` toggle.
- Below it, add an **Auto-fold rules** sub-section (visible when global toggle is off) with:
  - Add rule button
  - Each rule: folder input + tag input + delete button
- When the global toggle is on, show a note: "Auto-folds all files. Add rules below to
  fold only specific folders/tags instead (disable the global toggle first)."

### Migration / backward compat

- `autoFoldRules` defaults to `[]`. Existing users keep their `autoFold` toggle behaviour.

---

## ✅ Phase 4 — UI polish and drag-to-reorder (completed v1.4.0)

**Goal:** Make priority order clear and easy to manage.

- Add Up / Down arrow buttons on each entry row to move it in the list (controls priority).
- Or implement drag-to-reorder using HTML5 drag events (no external library needed in
  the Obsidian environment).
- Add a small **priority badge** (`#1`, `#2`, …) at the left of each entry row so users
  can see the order at a glance.
- Add visual grouping: collapsible sections for "Hide rules" vs "Show rules" vs "Auto-fold
  rules", or a filter/search bar for large rule sets.
- Improve the settings entry layout — current inline row is crowded. Consider an
  accordion/expand pattern: click an entry header to expand its full options.

---

## Implementation order recommendation

```
Phase 1  ✅ DONE
  └── 1a. Remove duplicate-name guard from UI
  └── 1b. Add action: 'hide' | 'show' field + migration
  └── 1c. Update genAllCSS to first-match-wins
  └── 1d. Update applyRegexHiding to first-match-wins (→ applyConditionalHiding)
  └── 1e. Add action toggle to settings UI
  └── 1f. Add Up/Down reorder buttons (minimal)

Phase 2  ✅ DONE
  └── 2a. Add valueCondition field + migration
  └── 2b. Extract applyConditionalHiding() — merges regex + value-condition DOM paths
  └── 2c. Add metadata-cache-changed listener
  └── 2d. Add valueCondition UI input per entry

Phase 3  ✅ DONE
  └── 3a. Add autoFoldRules to settings + migration
  └── 3b. Update file-open handler
  └── 3c. Add autoFoldRules UI section

Phase 4  ✅ DONE
  └── 4a. Drag-to-reorder (or Up/Down buttons already added in 1f)
  └── 4b. Priority badges
  └── 4c. Expanded entry accordion layout
```

---

## Notes on the existing "show per folder/tag" request

The request for "properties that keep displaying per folder and tag" is fully satisfied by
Phase 1: create an entry with `action = 'show'`, set a `folderFilter` or `tagFilter`, and
place it at a higher priority (earlier in the list) than any conflicting hide rule. No
separate feature is needed — the unified rule system handles it.

The global `propertiesVisible` string is kept as a convenience for simple cases and backward
compat, but the Phase 1 rules are the recommended way forward for context-sensitive visibility.

---

## Version targets (rough)

| Phase | Suggested version | Status    |
|-------|------------------|-----------|
| 1     | 1.1.0            | ✅ Done   |
| 2     | 1.2.0            | ✅ Done   |
| 3     | 1.3.0            | ✅ Done   |
| 4     | 1.4.0            | ✅ Done   |
