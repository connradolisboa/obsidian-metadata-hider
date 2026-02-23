# CLAUDE.md — Obsidian Metadata Hider

## Project Overview

An Obsidian plugin (v1.0.2) that hides frontmatter/metadata properties based on user-defined rules. Users can hide empty properties, hide specific named properties, and control visibility across different views (editor table, file-properties side dock, all-properties side dock).

**Author:** Benature | **Min Obsidian:** 0.15.0 | **License:** MIT

---

## Project Structure

```
obsidian-metadata-hider/
├── main.ts              # All plugin logic (475 lines) — entry point
├── src/
│   ├── i18n.ts          # EN / ZH locale strings
│   └── util.ts          # string2list() helper
├── styles.css           # CSS for .mh-hide class (all-properties side dock)
├── manifest.json        # Plugin metadata (id, version, minAppVersion)
├── esbuild.config.mjs   # Build config
├── tsconfig.json        # TypeScript config (strict mode)
└── package.json         # Dev deps: obsidian, typescript, esbuild
```

---

## Architecture

### Data Model

```typescript
interface entryHideSettings {
    tableInactive: boolean; // hide when metadata table is NOT focused
    tableActive: boolean;   // ALWAYS hide (even when focused)
    fileProperties: boolean; // hide in file-properties side dock
    allProperties: boolean;  // hide in all-properties side dock
}
interface entrySettings { name: string; hide: entryHideSettings; }
interface MetadataHiderSettings {
    autoFold: boolean;
    hideEmptyEntry: boolean;
    hideEmptyEntryInSideDock: boolean;
    propertiesVisible: string;   // comma-separated always-show list
    propertyHideAll: string;     // property name that hides whole table when checked
    entries: entrySettings[];
}
```

### Key Classes

| Class | File | Purpose |
|---|---|---|
| `MetadataHider` | main.ts:39 | Plugin lifecycle, CSS injection, DOM events |
| `MetadataHiderSettingTab` | main.ts:259 | Settings UI |
| `Locals` | src/i18n.ts:52 | i18n locale switching |

### CSS Strategy

Hiding works via dynamically injected CSS rules (`<style id="css-metadata-hider">` in `<head>`), regenerated on every settings change. The exception is the all-properties side dock: `hideInAllProperties()` toggles `.mh-hide` class on DOM elements directly (CSS approach doesn't work there).

Key CSS selectors used:
- `.metadata-container > .metadata-content > .metadata-properties > .metadata-property[data-property-key="X"]`
- `.metadata-container.is-active` — class toggled by `focusin`/`focusout` events to show all when editing
- `.workspace-leaf-content[data-type="file-properties"]` — file-properties side dock
- `.workspace-split:not(.mod-sidedock)` — main editor pane

### Event Handling

| Event | Handler | Purpose |
|---|---|---|
| `active-leaf-change` | main.ts:72 | Re-run `hideInAllProperties()` when switching to all-properties view |
| `focusin` | main.ts:76 | Add `is-active` to metadata container; trigger add-button click |
| `focusout` | main.ts:99 | Remove `is-active` after 100ms delay |
| `file-open` | main.ts:114 | Auto-fold metadata table if setting enabled |
| `onLayoutReady` | main.ts:68 | Initial CSS injection (100ms delay) |

---

## Known Bugs

### Critical

**1. `onunload()` will crash if `updateCSS()` never ran** ([main.ts:124-131](main.ts#L124))
```typescript
// BUG: this.styleTag is undefined if updateCSS() hasn't been called
onunload() {
    const parentElement = this.styleTag.parentElement; // TypeError!
```
Fix: `this.styleTag?.parentElement?.removeChild(this.styleTag)`

**2. `active-leaf-change` listener leaks on unload** ([main.ts:72](main.ts#L72))
```typescript
this.app.workspace.on('active-leaf-change', ...)  // NOT using registerEvent!
```
Fix: Wrap in `this.registerEvent(...)` like the `file-open` listener on line 114.

**3. Settings migration produces incomplete objects** ([main.ts:175-181](main.ts#L175))
```typescript
// as unknown as entryHideSettings bypasses type checking
// fileProperties and allProperties will be undefined, not false
entries.push({ name: key, hide: { tableInactive: true, tableActive: true } as unknown as entryHideSettings });
```
Fix: Provide all four boolean fields explicitly.

**4. `genCSS()` emits invalid CSS when property list is empty** ([main.ts:191-199](main.ts#L191))
When `properties` is empty, `body.join(',')` is `""`, producing `/* comment */  { display: none }` — a rule with no selector. Fix: return `""` early if `properties.length === 0`.

### Moderate

**5. Traditional Chinese (`zh-TW`) falls back to Simplified Chinese** ([src/i18n.ts:58-59](src/i18n.ts#L58))
```typescript
case "zh-tw":
    return ZH; // should return a ZH_TW object with Traditional Chinese strings
```

**6. No duplicate property name validation** ([main.ts:389](main.ts#L389))
Only checks for empty names; duplicate names silently generate duplicate CSS rules.

**7. Unsanitized user input in CSS selectors** ([main.ts:195](main.ts#L195), [main.ts:225](main.ts#L225))
Property names go directly into `[data-property-key="..."]` and `:has(...)` CSS. Special characters (e.g., `"`, `\`) could break CSS. Validate or escape input.

**8. Hard-coded 100ms timeouts** ([main.ts:69](main.ts#L69), [main.ts:73](main.ts#L73))
Fragile on slow machines. Document why they're needed or replace with proper lifecycle hooks.

---

## Improvement Opportunities

### Code Quality
- Replace `== null` with `=== null` for strict equality consistency
- Replace magic numbers (100ms timeouts) with named constants
- Clean up large blocks of commented-out dead code (lines 309-336)
- `genAllCSS()` returns single-line CSS — add newlines for debuggability
- `getLang()` on line 269 duplicates logic from `Locals.get()`; consolidate

### Architecture
- All locale strings are partially inlined in `display()` (lines 298-379) outside of `i18n.ts`. Move all user-facing strings into the locale system.
- The `propertiesVisible` setting uses comma-separated string; consider migrating to `string[]` like `entries` for consistency.

### Features (Requested / Logical Next Steps)
- **Regex matching** for property names (hide `my-prop-*`)
- **Quick toggle command** — command palette entry to temporarily show all metadata
- **Per-folder / per-tag rules** — apply different hide settings based on file location or tags
- **Import / export settings** — JSON backup for sharing configurations
- **Property autocomplete** — suggest known property names when adding entries
- **Preset profiles** — save/load named configurations

---

## Development Workflow

```bash
npm run dev      # watch mode build (outputs main.js)
npm run build    # typecheck + production build
npm run version  # bump version (updates manifest.json + versions.json)
```

Install for testing: symlink this directory into your vault's `.obsidian/plugins/metadata-hider/` folder.

---

## Coding Conventions

- TypeScript strict mode enabled (`tsconfig.json`)
- No test suite exists — manually test in Obsidian
- Avoid `@ts-ignore`; fix the underlying type issue instead
- Use `registerEvent()` / `registerDomEvent()` for all event listeners so Obsidian handles cleanup automatically
- Call `debounceUpdateCSS()` (not `updateCSS()` directly) after settings changes
- Always call `this.display()` after structural settings changes (add/remove entries) to re-render the settings UI

---

## CSS Selector Reference

| Selector | What it targets |
|---|---|
| `.metadata-container` | The frontmatter block in the editor |
| `.metadata-container.is-active` | Frontmatter block when user is editing it (added by this plugin) |
| `.metadata-property[data-property-key="X"]` | A specific property row |
| `.workspace-leaf-content[data-type="file-properties"]` | File Properties side dock |
| `.workspace-leaf-content[data-type="all-properties"]` | All Properties side dock |
| `.workspace-split:not(.mod-sidedock)` | Main editor area |
| `.mod-sidedock` | Either side dock |
| `.tree-item.mh-hide` | Item hidden in all-properties view (class-based, not CSS injection) |
