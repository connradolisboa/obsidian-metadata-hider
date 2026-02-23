# CLAUDE.md — Metadata Hider

## Project overview

Obsidian community plugin (v1.0.2) that hides frontmatter/metadata properties based on user-defined rules. Users can hide empty properties, hide specific named properties, and control visibility across the editor table and side docks.

- **Author:** Benature | **Min Obsidian:** 0.15.0 | **License:** MIT
- Entry point: `main.ts` compiled to `main.js`.
- Release artifacts: `main.js`, `manifest.json`, `styles.css`.

---

## Environment & tooling

- **Package manager:** npm
- **Bundler:** esbuild (`esbuild.config.mjs`)

```bash
npm install       # install deps
npm run dev       # watch mode build
npm run build     # typecheck + production build
npm run version   # bump version (updates manifest.json + versions.json)
```

---

## Project structure

```
obsidian-metadata-hider/
├── main.ts              # Plugin lifecycle + all feature logic (~475 lines)
├── src/
│   ├── i18n.ts          # EN / ZH locale strings
│   └── util.ts          # string2list() helper
├── styles.css           # .mh-hide class (all-properties side dock)
├── manifest.json
├── esbuild.config.mjs
├── tsconfig.json        # strict mode
└── package.json
```

---

## Architecture

### Settings model

```typescript
interface entryHideSettings {
    tableInactive: boolean; // hide when metadata table is NOT focused
    tableActive: boolean;   // always hide (even when focused)
    fileProperties: boolean;
    allProperties: boolean;
}
interface entrySettings { name: string; hide: entryHideSettings; }
interface MetadataHiderSettings {
    autoFold: boolean;
    hideEmptyEntry: boolean;
    hideEmptyEntryInSideDock: boolean;
    propertiesVisible: string;   // comma-separated always-show list
    propertyHideAll: string;     // property that hides whole table when checked
    entries: entrySettings[];
}
```

### CSS strategy

Hiding is done via a dynamically injected `<style id="css-metadata-hider">` tag regenerated on every settings change. The all-properties side dock is the exception — `hideInAllProperties()` toggles `.mh-hide` directly on DOM elements because CSS injection doesn't reach it reliably.

Key selectors:
- `.metadata-property[data-property-key="X"]` — target a specific property row
- `.metadata-container.is-active` — frontmatter block while user is editing (toggled by `focusin`/`focusout`)
- `.workspace-leaf-content[data-type="file-properties"]` — file-properties side dock
- `.workspace-split:not(.mod-sidedock)` — main editor pane

### Event listeners

Always use `registerEvent()` / `registerDomEvent()` so Obsidian cleans up on unload.

| Event | Purpose |
|---|---|
| `active-leaf-change` | Re-run `hideInAllProperties()` when switching views |
| `focusin` / `focusout` | Toggle `is-active` on metadata container |
| `file-open` | Auto-fold metadata table if setting enabled |

---

## Testing

Copy build artifacts to your vault and reload:
```
<Vault>/.obsidian/plugins/metadata-hider/main.js
<Vault>/.obsidian/plugins/metadata-hider/manifest.json
<Vault>/.obsidian/plugins/metadata-hider/styles.css
```

No automated test suite — test manually in Obsidian.

---

## Coding conventions

- TypeScript strict mode.
- Avoid `@ts-ignore`; fix the underlying type issue.
- Use `registerEvent()` / `registerDomEvent()` for all listeners.
- Call `debounceUpdateCSS()` (not `updateCSS()` directly) after settings changes.
- Call `this.display()` after structural settings changes (add/remove entries) to re-render settings UI.
- Sanitize user input before embedding it in CSS selectors (`[data-property-key="..."]`).
