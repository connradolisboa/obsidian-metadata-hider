import { App, Notice, Plugin, PluginSettingTab, Setting, debounce, ButtonComponent, ToggleComponent, Modal, TFile, getAllTags } from 'obsidian';
import { Locals } from 'src/i18n';
import { string2list } from 'src/util'

interface entryHideSettings {
	tableInactive: boolean; // hide in .mod-root when .metadata-container is inactive
	tableActive: boolean;   // hide in .mod-root when .metadata-container is active
	fileProperties: boolean;
	allProperties: boolean;
}
interface entrySettings {
	name: string;
	isRegex: boolean;       // treat name as a JS regex pattern
	folderFilter: string;   // apply only in files under this folder path (empty = all)
	tagFilter: string;      // apply only in files with this tag (empty = all)
	action: 'hide' | 'show'; // Phase 1: default 'hide'
	valueCondition: string;  // Phase 2: fire only when property value matches (empty = any)
	hide: entryHideSettings; // only meaningful when action === 'hide'
}
interface MetadataHiderSettings {
	autoFold: boolean;
	hideEmptyEntry: boolean;
	hideEmptyEntryInSideDock: boolean;
	propertiesVisible: string;
	propertyHideAll: string;
	entries: entrySettings[];
}

const DEFAULT_SETTINGS: MetadataHiderSettings = {
	autoFold: false,
	hideEmptyEntry: true,
	hideEmptyEntryInSideDock: false,
	propertiesVisible: "",
	propertyHideAll: "hide",
	entries: [],
}

function isEntryApplicable(entry: entrySettings, file: TFile | null, app: App): boolean {
	if (!entry.folderFilter?.trim() && !entry.tagFilter?.trim()) return true;
	if (!file) return false;

	if (entry.folderFilter?.trim()) {
		let folder = entry.folderFilter.trim();
		if (!folder.endsWith('/')) folder += '/';
		if (!file.path.startsWith(folder)) return false;
	}

	if (entry.tagFilter?.trim()) {
		const targetTag = entry.tagFilter.trim().toLowerCase();
		const normalizedTarget = targetTag.startsWith('#') ? targetTag : '#' + targetTag;
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) return false;
		const fileTags = (getAllTags(cache) ?? []).map(t => t.toLowerCase());
		if (!fileTags.includes(normalizedTarget)) return false;
	}

	return true;
}

function matchesEntryName(propertyKey: string, entry: entrySettings): boolean {
	const normalizedKey = propertyKey.toLowerCase();
	if (entry.isRegex) {
		try {
			return new RegExp(entry.name, 'i').test(normalizedKey);
		} catch {
			return false;
		}
	}
	return normalizedKey === entry.name.toLowerCase();
}

/** Build a lowercased frontmatter lookup map. Array values are preserved as string arrays. */
function buildFrontmatterLower(frontmatter: Record<string, any> | null | undefined): Record<string, string | string[]> {
	if (!frontmatter) return {};
	const result: Record<string, string | string[]> = {};
	for (const [k, v] of Object.entries(frontmatter)) {
		if (Array.isArray(v)) {
			result[k.toLowerCase()] = v.map(item => String(item ?? '').toLowerCase());
		} else {
			result[k.toLowerCase()] = String(v ?? '').toLowerCase();
		}
	}
	return result;
}

/**
 * Phase 2: Returns true if the entry's valueCondition matches the property's current value.
 * Empty valueCondition always returns true (matches any value).
 * Reads DOM input first for live feedback; falls back to frontmatter.
 */
function matchesValueCondition(
	entry: entrySettings,
	key: string,
	frontmatterLower: Record<string, string | string[]>,
	propEl: HTMLElement | null
): boolean {
	const cond = entry.valueCondition?.trim();
	if (!cond) return true;

	const conditions = cond.split(',').map(v => v.trim().toLowerCase()).filter(v => v !== '');
	if (conditions.length === 0) return true;

	// Prefer DOM input value for live feedback while editing
	const domInput = propEl?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="checkbox"]), textarea');
	if (domInput) {
		return conditions.includes(domInput.value.toLowerCase().trim());
	}

	// Fall back to frontmatter
	const fmVal = frontmatterLower[key];
	if (fmVal === undefined) return false;

	if (Array.isArray(fmVal)) {
		return fmVal.some(v => conditions.includes(v));
	}
	return conditions.includes(fmVal as string);
}

export default class MetadataHider extends Plugin {
	settings: MetadataHiderSettings;
	styleTag: HTMLStyleElement;
	isMetadataFocused: boolean;

	debounceUpdateCSS = debounce(this.updateCSS, 1000, true);
	debounceApplyConditional = debounce(() => this.applyConditionalHiding(), 200, true);

	hideInAllProperties() {
		const metadataElement = document.querySelector('.workspace-leaf-content[data-type="all-properties"] .view-content');
		if (metadataElement == null) { return; }

		const activeFile = this.app.workspace.getActiveFile();
		const frontmatterLower = buildFrontmatterLower(
			activeFile ? this.app.metadataCache.getFileCache(activeFile)?.frontmatter : null
		);

		const items = metadataElement.querySelectorAll('.tree-item');
		items.forEach(item => {
			const inner = item.querySelector('.tree-item-inner');
			const key = (
				(item as HTMLElement).dataset?.propertyKey ?? inner?.textContent?.trim() ?? ''
			).toLowerCase();

			let matched = false;
			for (const entry of this.settings.entries) {
				if (!matchesEntryName(key, entry)) continue;
				if (!isEntryApplicable(entry, activeFile, this.app)) continue;
				if (!matchesValueCondition(entry, key, frontmatterLower, null)) continue;

				matched = true;
				const shouldHide = entry.action === 'hide' && entry.hide.allProperties;
				item.classList.toggle('mh-hide', shouldHide);
				break; // first match wins
			}
			if (!matched) {
				item.classList.remove('mh-hide');
			}
		});
	}

	/**
	 * Phase 1+2: Handles DOM-path entries (regex and/or valueCondition) using first-match-wins.
	 * Replaces the former applyRegexHiding(). Also coordinates with CSS-path entries: when a
	 * CSS entry is the first match for a property, DOM overrides are cleared so CSS takes effect.
	 */
	applyConditionalHiding() {
		const activeFile = this.app.workspace.getActiveFile();
		const frontmatterLower = buildFrontmatterLower(
			activeFile ? this.app.metadataCache.getFileCache(activeFile)?.frontmatter : null
		);

		// Quick exit when no DOM-path entries exist
		const hasDomEntries = this.settings.entries.some(e => e.isRegex || e.valueCondition?.trim());
		if (!hasDomEntries) return;

		const containers = document.querySelectorAll(
			'.workspace-leaf.mod-active .metadata-container, .workspace-leaf-content[data-type="file-properties"] .metadata-container'
		);

		containers.forEach(container => {
			const inFileProps = !!container.closest('.workspace-leaf-content[data-type="file-properties"]');
			const isActive = container.classList.contains('is-active');

			container.querySelectorAll<HTMLElement>('.metadata-property[data-property-key]').forEach(prop => {
				const key = prop.dataset?.propertyKey ?? '';

				// First-match-wins: iterate all entries in order
				for (const entry of this.settings.entries) {
					if (!matchesEntryName(key, entry)) continue;
					if (!isEntryApplicable(entry, activeFile, this.app)) continue;
					if (!matchesValueCondition(entry, key, frontmatterLower, prop)) continue;

					// First match found
					if (!entry.isRegex && !entry.valueCondition?.trim()) {
						// CSS entry claims this property — clear any stale DOM overrides
						prop.classList.remove('mh-hide', 'mh-show');
						break;
					}

					// DOM entry — apply based on action and targets
					if (entry.action === 'show') {
						prop.classList.add('mh-show');
						prop.classList.remove('mh-hide');
					} else {
						let shouldHide = false;
						if (inFileProps) shouldHide = entry.hide.fileProperties;
						else if (entry.hide.tableActive) shouldHide = true;
						else if (entry.hide.tableInactive && !isActive) shouldHide = true;
						prop.classList.toggle('mh-hide', shouldHide);
						prop.classList.remove('mh-show');
					}
					break;
				}
			});
		});
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MetadataHiderSettingTab(this.app, this));

		const DOM_READY_DELAY_MS = 100;

		this.app.workspace.onLayoutReady(() => {
			setTimeout(() => { this.updateCSS(); }, DOM_READY_DELAY_MS);
		});

		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf && leaf.view.getViewType() === "all-properties") {
				setTimeout(() => { this.hideInAllProperties(); }, DOM_READY_DELAY_MS);
			}
			setTimeout(() => { this.applyConditionalHiding(); }, DOM_READY_DELAY_MS);
		}));

		this.registerDomEvent(document, 'focusin', (evt: MouseEvent) => {
			const target = evt.target;
			const metadataElement = document.querySelector('.workspace-leaf.mod-active .metadata-container');
			if (metadataElement === null) { return; }
			if (metadataElement?.contains(target as Node)) {
				metadataElement.classList.add('is-active');
				this.isMetadataFocused = true;
				// @ts-ignore
				if (target?.classList?.contains("metadata-add-button")) {
					const clickEvent = new MouseEvent('click', {
						bubbles: true,
						cancelable: true,
						view: window
					});
					target.dispatchEvent(clickEvent);
				}
			} else if (this.isMetadataFocused) {
				this.isMetadataFocused = false;
				metadataElement.classList.remove('is-active');
			}
		});

		this.registerDomEvent(document, 'focusout', (evt: MouseEvent) => {
			const target = evt.target;
			const metadataElement = document.querySelector('.workspace-leaf.mod-active .metadata-container');
			if (metadataElement?.contains(target as Node)) {
				this.isMetadataFocused = false;
				setTimeout(() => {
					if (!this.isMetadataFocused) {
						metadataElement.classList.remove('is-active');
					}
				}, 100);
			}
		});

		this.registerEvent(this.app.workspace.on('file-open', (_file) => {
			if (this.settings.autoFold) {
				const metadataElement = document.querySelector('.workspace-leaf.mod-active .metadata-container');
				if (!metadataElement?.classList.contains('is-collapsed')) {
					// @ts-ignore
					this.app.commands.executeCommandById(`editor:toggle-fold-properties`);
				}
			}
			// Re-generate CSS and conditional hiding whenever file changes
			setTimeout(() => { this.updateCSS(); }, DOM_READY_DELAY_MS);
		}));

		// Phase 2: Re-evaluate value-condition rules when the metadata cache updates (after save)
		this.registerEvent(this.app.metadataCache.on('changed', (_file: TFile) => {
			this.debounceApplyConditional();
		}));

		// Phase 2: Live feedback while the user is editing a property value
		this.registerDomEvent(document, 'input', (evt: Event) => {
			const target = evt.target as HTMLElement | null;
			if (target?.closest('.metadata-container')) {
				this.debounceApplyConditional();
			}
		});
	}

	onunload() {
		this.styleTag?.parentElement?.removeChild(this.styleTag);
	}

	updateCSS() {
		this.styleTag = document.createElement('style');
		this.styleTag.id = 'css-metadata-hider';
		let headElement: HTMLElement = document.getElementsByTagName('head')[0];
		const existingStyleTag = headElement.querySelector('#' + this.styleTag.id) as HTMLStyleElement | null;

		if (existingStyleTag) {
			existingStyleTag.parentNode?.removeChild(existingStyleTag);
		}

		headElement.appendChild(this.styleTag);
		this.styleTag.innerText = genAllCSS(this);

		this.hideInAllProperties();
		this.applyConditionalHiding();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.upgradeSettingsToVersion1();
		// Ensure all fields have defaults on existing entries (handles older saved data)
		this.settings.entries = (this.settings.entries as any[]).map(e =>
			Object.assign({ isRegex: false, folderFilter: '', tagFilter: '', action: 'hide', valueCondition: '' }, e)
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	upgradeSettingsToVersion1() { // upgrade settings from version 0.x to 1.x
		if (this.settings.entries.length == 0 &&
			// @ts-ignore
			(this.settings.propertiesInvisible || this.settings.propertiesInvisibleAlways)) {
			// @ts-ignore
			const propertiesInvisible = string2list(this.settings.propertiesInvisible);
			// @ts-ignore
			const propertiesInvisibleAlways = string2list(this.settings.propertiesInvisibleAlways);
			const inter = propertiesInvisible.filter(x => propertiesInvisibleAlways.includes(x))
			const union = new Set([...propertiesInvisible, ...propertiesInvisibleAlways]);
			const diff1 = new Set([...union].filter(x => !propertiesInvisible.includes(x)));
			const diff2 = new Set([...union].filter(x => !propertiesInvisibleAlways.includes(x)));
			const entries: entrySettings[] = [];
			for (let key of inter) {
				entries.push({ name: key, isRegex: false, folderFilter: '', tagFilter: '', action: 'hide', valueCondition: '', hide: { tableInactive: true, tableActive: true, fileProperties: false, allProperties: false } });
			}
			for (let key of diff1) {
				entries.push({ name: key, isRegex: false, folderFilter: '', tagFilter: '', action: 'hide', valueCondition: '', hide: { tableInactive: true, tableActive: true, fileProperties: false, allProperties: false } });
			}
			for (let key of diff2) {
				entries.push({ name: key, isRegex: false, folderFilter: '', tagFilter: '', action: 'hide', valueCondition: '', hide: { tableInactive: true, tableActive: false, fileProperties: false, allProperties: false } });
			}
			this.settings.entries = entries;
			this.saveSettings();
		}
	}
}



function escapeCSSAttrValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function genCSS(properties: string[], cssPrefix: string, cssSuffix: string, parentSelector: string = ""): string {
	if (properties.length === 0) return "";
	let body: string[] = [];
	parentSelector = parentSelector ? parentSelector + " " : "";
	for (let property of properties) {
		body.push(`${parentSelector}.metadata-container > .metadata-content > .metadata-properties > .metadata-property[data-property-key="${escapeCSSAttrValue(property.trim().toLowerCase())}"]`);
	}
	const sep = "\n";
	return cssPrefix + sep + body.join(',' + sep) + sep + cssSuffix + "\n\n";
}

/**
 * Phase 1: First-match-wins CSS generation.
 * Iterates entries in order; the first applicable entry for each property key determines
 * whether it is hidden or shown. Later entries for the same key are ignored for this file.
 */
function genAllCSS(plugin: MetadataHider): string {
	const s = plugin.settings;
	const activeFile = plugin.app.workspace.getActiveFile();

	let content: string[] = [];

	// Base classes for DOM-managed visibility (regex / valueCondition / allProperties paths)
	content.push(`.metadata-property.mh-hide { display: none !important; }`);
	content.push(`.metadata-property.mh-show { display: flex !important; }`);

	if (s.hideEmptyEntry) {
		content = content.concat([
			// Show all metadata when it is focused
			`.metadata-container.is-active .metadata-property { display: flex !important; }`,
			/* * Hide the metadata that is empty */
			`.metadata-container .metadata-property:has(.metadata-property-value .mod-truncate:empty),`,
			`.metadata-container .metadata-property[data-property-type="number"]:has(input.metadata-input:not([value]):not(:focus)),`,
			`.metadata-container .metadata-property[data-property-type="text"]:has(input[type="date"]),`,
			`.metadata-container .metadata-property:has(.metadata-property-value .multi-select-container > .multi-select-input:first-child),`,
			`.metadata-container .metadata-property[data-property-type="checkbox"]:has(input[type="checkbox"]:not(:checked)) {`,
			`	display: none;`,
			`}`,
		]);
	}

	if (!s.hideEmptyEntryInSideDock) {
		content.push(`.mod-sidedock .metadata-property { display: flex !important; }`);
	}

	if (s.propertyHideAll.trim()) {
		content.push([
			`.metadata-container:has(.metadata-property[data-property-key="${escapeCSSAttrValue(s.propertyHideAll.trim().toLowerCase())}"] input[type="checkbox"]:checked) {`,
			`  display: none;`,
			`}`,
			``,
		].join('\n'));
	}

	// First-match-wins: only non-regex, no-valueCondition entries are handled here via CSS.
	// Regex and valueCondition entries are handled by applyConditionalHiding() via the DOM.
	const claimed = new Set<string>();

	const propSel = (key: string, parentSelector = '') => {
		const parent = parentSelector ? parentSelector + ' ' : '';
		return `${parent}.metadata-container > .metadata-content > .metadata-properties > .metadata-property[data-property-key="${escapeCSSAttrValue(key)}"]`;
	};

	for (const entry of s.entries) {
		if (entry.isRegex || entry.valueCondition?.trim()) continue; // DOM path
		if (!isEntryApplicable(entry, activeFile, plugin.app)) continue;

		const key = entry.name.trim().toLowerCase();
		if (!key) continue;
		if (claimed.has(key)) continue; // already claimed by a higher-priority entry
		claimed.add(key);

		if (entry.action === 'show') {
			content.push(`/* show: ${key} */`);
			content.push(`${propSel(key)} { display: flex !important; }`);
		} else {
			// action === 'hide'
			if (entry.hide.fileProperties) {
				content.push(propSel(key, `.workspace-leaf-content[data-type="file-properties"]`) + ` { display: none !important; }`);
			}
			if (entry.hide.tableInactive || entry.hide.tableActive) {
				content.push(`${propSel(key)} { display: none; }`);
			}
			if (entry.hide.tableActive) {
				content.push(propSel(key, `.workspace-split:not(.mod-sidedock)`) + ` { display: none !important; }`);
			}
		}
	}

	// propertiesVisible — unconditional show rules appended last (backward compat)
	content.push(genCSS(
		string2list(plugin.settings.propertiesVisible),
		'/* * Always visible */',
		' { display: flex; }'
	));

	return content.join('\n') + '\n';
}


class ImportSettingsModal extends Modal {
	plugin: MetadataHider;
	settingsTab: MetadataHiderSettingTab;

	constructor(app: App, plugin: MetadataHider, settingsTab: MetadataHiderSettingTab) {
		super(app);
		this.plugin = plugin;
		this.settingsTab = settingsTab;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Import settings' });
		contentEl.createEl('p', { text: 'Paste exported settings JSON below. This will replace the current settings.' });

		const textarea = contentEl.createEl('textarea');
		textarea.placeholder = 'Paste settings JSON here...';
		textarea.style.cssText = 'width:100%;height:200px;font-family:monospace;font-size:12px;margin:8px 0;box-sizing:border-box;';

		new Setting(contentEl)
			.addButton(btn =>
				btn.setButtonText('Import').setCta().onClick(async () => {
					try {
						const imported = JSON.parse(textarea.value);
						if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) {
							throw new Error('Expected a JSON object');
						}
						Object.assign(this.plugin.settings, imported);
						// Ensure new fields have defaults on imported entries
						this.plugin.settings.entries = (this.plugin.settings.entries as any[]).map(e =>
							Object.assign({ isRegex: false, folderFilter: '', tagFilter: '', action: 'hide', valueCondition: '' }, e)
						);
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
						this.settingsTab.display();
						this.close();
						new Notice('Settings imported successfully!');
					} catch (e) {
						new Notice('Import failed: ' + (e as Error).message);
					}
				})
			)
			.addButton(btn =>
				btn.setButtonText('Cancel').onClick(() => this.close())
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}


class MetadataHiderSettingTab extends PluginSettingTab {
	plugin: MetadataHider;

	constructor(app: App, plugin: MetadataHider) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getLang(): string {
		let lang = window.localStorage.getItem('language');
		if (lang == null || ["en", "zh", "zh-TW"].indexOf(lang) == -1) { lang = "en"; }
		return lang;
	}

	display(): void {
		const { containerEl } = this;
		const ts = Locals.get().setting;
		const lang = this.getLang();

		containerEl.empty();

		// === Import / Export ===
		new Setting(containerEl)
			.setName('Import / Export settings')
			.setDesc('Export current settings as JSON (copied to clipboard) or import previously exported settings.')
			.addButton(btn =>
				btn.setButtonText('Export').onClick(async () => {
					const json = JSON.stringify(this.plugin.settings, null, 2);
					await navigator.clipboard.writeText(json);
					new Notice('Settings copied to clipboard!');
				})
			)
			.addButton(btn =>
				btn.setButtonText('Import').onClick(() => {
					new ImportSettingsModal(this.app, this.plugin, this).open();
				})
			);

		new Setting(containerEl)
			.setName(ts.autoFold.name)
			.setDesc(ts.autoFold.desc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoFold)
					.onChange(async (value) => {
						this.plugin.settings.autoFold = value;
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
					});
			});

		new Setting(containerEl)
			.setName({ en: "Metadata properties that keep displaying", zh: "永远显示的文档属性（元数据）", "zh-TW": "永遠顯示的文件屬性（元數據）" }[lang] as string)
			.setDesc({ en: "Metadata properties will always display even if their value are empty. Metadata property keys are separated by comma (`,`).", zh: "英文逗号分隔（`,`）。例如：tags, aliases", "zh-TW": "以逗號分隔（`,`）" }[lang] as string)
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.propertiesVisible)
					.onChange(async (value) => {
						this.plugin.settings.propertiesVisible = value;
						await this.plugin.saveSettings();;
						this.plugin.debounceUpdateCSS();
					})
			);

		containerEl.createEl("h3", { text: ts.headings.hide });

		new Setting(containerEl)
			.setName({ en: 'Hide empty metadata properties', zh: "隐藏值为空的文档属性（元数据）", "zh-TW": "隱藏空白文件屬性（元數據）" }[lang] as string)
			.setDesc('')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.hideEmptyEntry)
					.onChange(async (value) => {
						this.plugin.settings.hideEmptyEntry = value;
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
						this.display();
					});
			});
		if (this.plugin.settings.hideEmptyEntry) {
			new Setting(containerEl)
				.setName({ en: 'Hide empty metadata properties also in side dock', zh: "侧边栏也隐藏值为空的文档属性（元数据）", "zh-TW": "側邊欄也隱藏空白文件屬性（元數據）" }[lang] as string)
				.setDesc('')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.hideEmptyEntryInSideDock)
						.onChange(async (value) => {
							this.plugin.settings.hideEmptyEntryInSideDock = value;
							await this.plugin.saveSettings();
							this.plugin.debounceUpdateCSS();
						});
				});
		}
		new Setting(containerEl)
			.setName({ en: "Key to hide the whole metadata properties table", zh: "隐藏整个文档属性（元数据）表格", "zh-TW": "隱藏整個文檔屬性（元數據）表格" }[lang] as string)
			.setDesc({ en: `when its value is true, the whole metadata properties table will be hidden`, zh: `当该属性值为真时`, "zh-TW": `當該屬性值為真時` }[lang] as string)
			.addText((cb) => {
				cb.setPlaceholder({ en: "entry name", zh: "文档属性名称", "zh-TW": "文件屬性名稱", }[lang] as string)
					.setValue(this.plugin.settings.propertyHideAll)
					.onChange(async (newValue) => {
						this.plugin.settings.propertyHideAll = newValue;
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
					});
			})

		// Shared datalist for property name autocomplete
		const datalistId = 'mh-property-autocomplete';
		const datalist = containerEl.createEl('datalist');
		datalist.id = datalistId;
		const knownProperties = Object.keys((this.plugin.app.metadataCache as any).getAllPropertyInfos?.() ?? {});
		knownProperties.sort().forEach(key => {
			datalist.createEl('option', { value: key });
		});

		let addEntryButton = new Setting(containerEl)
			.setName(ts.entries.addEntry)
			.addButton((button: ButtonComponent) => {
				button.setTooltip("Add new rule")
					.setButtonText("+")
					.setCta().onClick(async () => {
						if (this.plugin.settings.entries.filter(e => e.name === "").length > 0) {
							new Notice(`There is still an unnamed entry!`);
							return;
						}
						this.plugin.settings.entries.push({
							name: "",
							isRegex: false,
							folderFilter: "",
							tagFilter: "",
							action: "hide",
							valueCondition: "",
							hide: {
								tableInactive: true,
								tableActive: false,
								fileProperties: false,
								allProperties: false,
							}
						});
						await this.plugin.saveSettings();
						this.display();
					});
			})
		addEntryButton.descEl.append(
			createDiv({ text: `Action: Hide — apply hide targets below | Show — always show the property` }),
			createDiv({ text: `${ts.entries.toggle} 1: ${ts.entries.hide.tableInactive}` }),
			createDiv({ text: `${ts.entries.toggle} 2: ${ts.entries.hide.tableActive}` }),
			createDiv({ text: `${ts.entries.toggle} 3: ${ts.entries.hide.fileProperties}` }),
			createDiv({ text: `${ts.entries.toggle} 4: ${ts.entries.hide.allProperties}` }),
			createDiv({ text: `Value: fire rule only when property value matches (comma-separated, case-insensitive)` }),
			createDiv({ text: `Rules are evaluated top-to-bottom; the first matching rule wins.` }),
		)

		this.plugin.settings.entries.forEach((entrySetting, index) => {
			const s = new Setting(this.containerEl);
			s.setClass("metadata-hider-setting-entry");

			// Property name input with autocomplete
			s.addText((cb) => {
				cb.setPlaceholder(entrySetting.isRegex ? 'regex pattern' : 'property name')
					.setValue(entrySetting.name)
					.onChange(async (newValue) => {
						// Phase 1a: duplicate-name check removed — multiple rules for the same
						// property are now allowed (first-match-wins determines which fires).
						this.plugin.settings.entries[index].name = newValue.trim();
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
					});
				cb.inputEl.setAttribute('list', datalistId);
			});

			// Action toggle button: Hide ↔ Show
			s.addButton(btn => {
				const isShow = entrySetting.action === 'show';
				btn.setButtonText(isShow ? 'Show' : 'Hide')
					.setTooltip('Toggle between Hide and Show action')
					.onClick(async () => {
						this.plugin.settings.entries[index].action =
							this.plugin.settings.entries[index].action === 'show' ? 'hide' : 'show';
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
						this.display();
					});
				if (isShow) btn.setCta();
			});

			// Regex toggle
			s.addToggle(toggle =>
				toggle
					.setValue(entrySetting.isRegex)
					.setTooltip('Regex: treat name as a regular expression')
					.onChange(async (value) => {
						this.plugin.settings.entries[index].isRegex = value;
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
					})
			);

			// Hide-mode toggles — only shown when action === 'hide'
			if (entrySetting.action !== 'show') {
				let toggles: { [key: string]: ToggleComponent } = {};
				for (let key of ["tableInactive", "tableActive", "fileProperties", "allProperties"]) {
					s.addToggle((toggle) => {
						toggles[key] = toggle;
						toggle
							.setValue(this.plugin.settings.entries[index].hide[key as keyof entryHideSettings])
							// @ts-ignore
							.setTooltip(ts.entries.hide[key])
							.onChange(async (value) => {
								this.plugin.settings.entries[index].hide[key as keyof entryHideSettings] = value;

								if (key === "tableInactive" && value === false) {
									this.plugin.settings.entries[index].hide.tableActive = false;
									toggles["tableActive"].setValue(false);
								}

								if (key === "tableActive" && value === true) {
									this.plugin.settings.entries[index].hide.tableInactive = true;
									toggles["tableInactive"].setValue(true);
								}

								await this.plugin.saveSettings();
								this.plugin.debounceUpdateCSS();
							});
					});
				}
			}

			// Folder filter
			s.addText(cb => {
				cb.setPlaceholder('folder/')
					.setValue(entrySetting.folderFilter ?? '')
					.onChange(async (value: string) => {
						this.plugin.settings.entries[index].folderFilter = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
					});
				cb.inputEl.title = 'Apply only in files under this folder (e.g. Projects/)';
				cb.inputEl.style.width = '90px';
			});

			// Tag filter
			s.addText(cb => {
				cb.setPlaceholder('#tag')
					.setValue(entrySetting.tagFilter ?? '')
					.onChange(async (value: string) => {
						this.plugin.settings.entries[index].tagFilter = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
					});
				cb.inputEl.title = 'Apply only in files with this tag (e.g. #work)';
				cb.inputEl.style.width = '90px';
			});

			// Phase 2: Value condition input
			s.addText(cb => {
				cb.setPlaceholder('value equals…')
					.setValue(entrySetting.valueCondition ?? '')
					.onChange(async (value: string) => {
						this.plugin.settings.entries[index].valueCondition = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
					});
				cb.inputEl.title = 'Fire rule only when property value equals this. Comma-separate multiple values. Case-insensitive. Leave empty for any value.';
				cb.inputEl.style.width = '110px';
			});

			// Move up
			s.addExtraButton(btn => {
				btn.setIcon('arrow-up')
					.setTooltip('Move up (higher priority)')
					.onClick(async () => {
						if (index === 0) return;
						const entries = this.plugin.settings.entries;
						[entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
						this.display();
					});
				if (index === 0) btn.setDisabled(true);
			});

			// Move down
			s.addExtraButton(btn => {
				btn.setIcon('arrow-down')
					.setTooltip('Move down (lower priority)')
					.onClick(async () => {
						const entries = this.plugin.settings.entries;
						if (index >= entries.length - 1) return;
						[entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
						this.display();
					});
				if (index >= this.plugin.settings.entries.length - 1) btn.setDisabled(true);
			});

			// Delete
			s.addExtraButton((cb) => {
				cb.setIcon("cross")
					.setTooltip("Delete entry")
					.onClick(async () => {
						this.plugin.settings.entries.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
						this.plugin.debounceUpdateCSS();
					});
			});
		});


		let noteEl = containerEl.createEl("p", {
			text: {
				en: `When the metadata properties table is focused, (i.e. inputting metadata properties), all metadata properties will be displayed, except metadata properties that are marked as "Always hide".`,
				zh: `当文档属性（元数据）表格获得焦点时（即输入元数据），除"永远隐藏的文档属性"外的所有文档属性都将显示。`,
				"zh-TW": `當文檔屬性（元數據）表格獲得焦點時（即輸入元數據），除「永遠隱藏的文件屬性」外的所有文檔屬性都將顯示。`,
			}[lang] as string
		});
		noteEl.setAttribute("style", "color: gray; font-style: italic; margin-top: 30px;")
	}
}
