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
	isRegex: boolean;      // treat name as a JS regex pattern
	folderFilter: string;  // apply only in files under this folder path (empty = all)
	tagFilter: string;     // apply only in files with this tag (empty = all)
	hide: entryHideSettings;
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

export default class MetadataHider extends Plugin {
	settings: MetadataHiderSettings;
	styleTag: HTMLStyleElement;
	isMetadataFocused: boolean;

	hideInAllProperties() {
		const metadataElement = document.querySelector('.workspace-leaf-content[data-type="all-properties"] .view-content');
		if (metadataElement == null) { return; }

		const activeFile = this.app.workspace.getActiveFile();
		const hiddenEntries = this.settings.entries.filter(entry =>
			entry.hide.allProperties && isEntryApplicable(entry, activeFile, this.app)
		);

		const items = metadataElement.querySelectorAll('.tree-item');
		items.forEach(item => {
			const inner = item.querySelector('.tree-item-inner');
			const key = (item as HTMLElement).dataset?.propertyKey
				?? inner?.textContent?.trim()
				?? '';
			const match = hiddenEntries.some(entry => matchesEntryName(key, entry));
			if (match) {
				item.classList.add('mh-hide');
			} else {
				item.classList.remove('mh-hide');
			}
		});
	}

	applyRegexHiding() {
		const regexEntries = this.settings.entries.filter(e => e.isRegex);
		if (regexEntries.length === 0) return;

		const activeFile = this.app.workspace.getActiveFile();
		const applicableEntries = regexEntries.filter(e => isEntryApplicable(e, activeFile, this.app));
		if (applicableEntries.length === 0) return;

		const containers = document.querySelectorAll(
			'.workspace-leaf.mod-active .metadata-container, .workspace-leaf-content[data-type="file-properties"] .metadata-container'
		);

		containers.forEach(container => {
			const inFileProps = !!container.closest('.workspace-leaf-content[data-type="file-properties"]');
			const isActive = container.classList.contains('is-active');

			container.querySelectorAll<HTMLElement>('.metadata-property[data-property-key]').forEach(prop => {
				const key = prop.dataset?.propertyKey ?? '';
				const shouldHide = applicableEntries.some(entry => {
					if (!matchesEntryName(key, entry)) return false;
					if (inFileProps) return entry.hide.fileProperties;
					if (entry.hide.tableActive) return true;
					if (entry.hide.tableInactive && !isActive) return true;
					return false;
				});
				prop.classList.toggle('mh-hide', shouldHide);
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
			setTimeout(() => { this.applyRegexHiding(); }, DOM_READY_DELAY_MS);
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
			// Re-generate CSS and regex hiding whenever file changes (folder/tag rules may differ)
			setTimeout(() => { this.updateCSS(); }, DOM_READY_DELAY_MS);
		}));
	}

	onunload() {
		this.styleTag?.parentElement?.removeChild(this.styleTag);
	}

	debounceUpdateCSS = debounce(this.updateCSS, 1000, true);
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
		this.applyRegexHiding();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.upgradeSettingsToVersion1();
		// Ensure new fields have defaults on existing entries (from older saved data)
		this.settings.entries = (this.settings.entries as any[]).map(e =>
			Object.assign({ isRegex: false, folderFilter: '', tagFilter: '' }, e)
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
				entries.push({ name: key, isRegex: false, folderFilter: '', tagFilter: '', hide: { tableInactive: true, tableActive: true, fileProperties: false, allProperties: false } });
			}
			for (let key of diff1) {
				entries.push({ name: key, isRegex: false, folderFilter: '', tagFilter: '', hide: { tableInactive: true, tableActive: true, fileProperties: false, allProperties: false } });
			}
			for (let key of diff2) {
				entries.push({ name: key, isRegex: false, folderFilter: '', tagFilter: '', hide: { tableInactive: true, tableActive: false, fileProperties: false, allProperties: false } });
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

function genAllCSS(plugin: MetadataHider): string {
	const s = plugin.settings;
	const activeFile = plugin.app.workspace.getActiveFile();

	// Filter entries by folder/tag context; regex entries are handled via DOM, not CSS
	const applicableEntries = s.entries.filter(e => isEntryApplicable(e, activeFile, plugin.app));
	const cssEntries = applicableEntries.filter(e => !e.isRegex);

	let content: string[] = [];

	// Base rule so DOM-applied .mh-hide works everywhere (regex + all-properties)
	content.push(`.metadata-property.mh-hide { display: none !important; }\n`);

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
		content.push(`.mod-sidedock .metadata-property { display: flex !important; }`,)
	}

	if (s.propertyHideAll.trim()) {
		content.push([
			`.metadata-container:has(.metadata-property[data-property-key="${escapeCSSAttrValue(s.propertyHideAll.trim().toLowerCase())}"] input[type="checkbox"]:checked) {`,
			`  display: none;`,
			`}`,
			``,
		].join('\n'));
	}

	content.push(genCSS(
		cssEntries.filter((e: entrySettings) => e.hide.fileProperties).map(e => e.name),
		'/* * Invisible in file properties */',
		' { display: none !important; }',
		`.workspace-leaf-content[data-type="file-properties"] `
	))
	content.push(genCSS(
		cssEntries.filter((e: entrySettings) => e.hide.tableInactive || e.hide.tableActive).map(e => e.name),
		'/* * Invisible in properties table (in .mod-root) */',
		' { display: none; }'
	))
	content.push(genCSS(
		cssEntries.filter((e: entrySettings) => e.hide.tableActive).map(e => e.name),
		'/* * Always invisible in properties table (in .mod-root) */',
		' { display: none !important; }',
		".workspace-split:not(.mod-sidedock) "
	))

	content.push(genCSS(
		string2list(plugin.settings.propertiesVisible),
		'/* * Always visible */',
		' { display: flex; }'
	))

	return content.join(' ')
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
						// Ensure new fields have defaults
						this.plugin.settings.entries = (this.plugin.settings.entries as any[]).map(e =>
							Object.assign({ isRegex: false, folderFilter: '', tagFilter: '' }, e)
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
			.setName(ts.entries.addEntryToHide)
			.addButton((button: ButtonComponent) => {
				button.setTooltip("Add new entry")
					.setButtonText("+")
					.setCta().onClick(async () => {
						if (this.plugin.settings.entries.filter(e => e.name === "").length > 0) {
							new Notice(`There is still unnamed entry!`);
							return;
						}
						this.plugin.settings.entries.push({
							name: "",
							isRegex: false,
							folderFilter: "",
							tagFilter: "",
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
			createDiv({ text: `${ts.entries.toggle} 1: ${ts.entries.hide.tableInactive}` }),
			createDiv({ text: `${ts.entries.toggle} 2: ${ts.entries.hide.tableActive}` }),
			createDiv({ text: `${ts.entries.toggle} 3: ${ts.entries.hide.fileProperties}` }),
			createDiv({ text: `${ts.entries.toggle} 4: ${ts.entries.hide.allProperties}` }),
		)

		this.plugin.settings.entries.forEach((entrySetting, index) => {
			const s = new Setting(this.containerEl);
			s.setClass("metadata-hider-setting-entry");

			// Property name input with autocomplete
			s.addText((cb) => {
				cb.setPlaceholder(entrySetting.isRegex ? 'regex pattern' : 'property name')
					.setValue(entrySetting.name)
					.onChange(async (newValue) => {
						const trimmed = newValue.trim();
						const isDuplicate = this.plugin.settings.entries.some((e, i) => i !== index && e.name === trimmed && trimmed !== "");
						if (isDuplicate) {
							new Notice(`Property "${trimmed}" already exists!`);
							return;
						}
						this.plugin.settings.entries[index].name = trimmed;
						await this.plugin.saveSettings();
						this.plugin.debounceUpdateCSS();
					});
				// Attach shared datalist for autocomplete (most useful for exact-match entries)
				cb.inputEl.setAttribute('list', datalistId);
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

			// Hide-mode toggles (tableInactive / tableActive / fileProperties / allProperties)
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

			s.addExtraButton((cb) => {
				cb.setIcon("cross")
					.setTooltip("Delete Entry")
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
