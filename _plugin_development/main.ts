import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, moment } from 'obsidian';

interface BlockCollectionsSettings {
	canvasRelativePath: string;
	foldersToExclude: string[];
	showPlantUML: boolean;
	plantUMLFrontmatterKey: string;
	zoteroAuthorTitleKey: string;
	zoteroItemIdKey: string;
	parseSpacesAsTerms: boolean;
}

const DEFAULT_SETTINGS: BlockCollectionsSettings = {
	canvasRelativePath: 'HUB/_DashboardStuff/Collections Dashboard.canvas',
	foldersToExclude: ['SYSTEM', 'DAILY', 'assets', 'HUB'],
	showPlantUML: true,
	plantUMLFrontmatterKey: 'plantuml_nodes',
	zoteroAuthorTitleKey: 'zotero_author-title',
	zoteroItemIdKey: 'zotero_itemid',
	parseSpacesAsTerms: false
};

const CONFIG = {
	canvas: {
		relativePathFallback: DEFAULT_SETTINGS.canvasRelativePath,
		layout: {
			standardWidth: 400,
			wideWidth: 500,
			spacing: {
				xGap: 440,
				yGap: 60,
				lineHeight: 24,
				buttonHeight: 52,
				buttonSpacing: 8,
				listSpacing: 16,
				cardPadding: 16
			},
			columns: {
				start: -760,
				standard: [-760, -280, 160, 600, 1040],
				wide: [1480]
			},
			startY: -260
		}
	},
	adderModal: {
		width: '720px',
		height: '930px'
	},
	querierModal: {
		width: '720px',
		height: '750px'
	},
	collectionDropdown: {
		maxHeight: '120px',
		visibleValues: 3,
		itemHeight: '20px',
		fontSize: '0.85em',
		padding: '4px',
		marginTop: '4px',
		marginBottom: '8px',
		borderRadius: '4px',
		searchPlaceholder: 'Filter collections...'
	},
	queryDropdown: {
		maxHeight: '140px',
		visibleValues: 5,
		itemHeight: '28px',
		fontSize: '0.85em',
		padding: '4px',
		marginTop: '4px',
		marginBottom: '8px',
		borderRadius: '4px',
		searchPlaceholder: 'Filter values with regex supported (no / needed)'
	},
	blockIdModal: {
		width: '520px',
		maxHeight: '80vh',
		resultsContainer: {
			maxHeight: '300px'
		}
	},
	styling: {
		fileHighlight: {
			backgroundColor: 'rgba(255, 165, 0, 0.1)',
			fontWeight: '500'
		}
	}
};

const allowedAfterBlockID = ['- ', '> ', '```'];

function isAllowedAfterBlockID(line: string): boolean {
	return allowedAfterBlockID.some(prefix => line.trimStart().startsWith(prefix));
}

function generateRandomBlockId(): string {
	return Array(6)
		.fill(0)
		.map(() => 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36)))
		.join('');
}

function ensureProperLineSpacing(content: string, blockStart: number, blockEnd: number, newBlock: string): string {
	let afterBlock = content.substring(blockEnd);
	const nextNonEmptyLine = afterBlock.split('\n').find(line => line.trim().length > 0) || '';

	if (afterBlock.length === 0) {
		let normalizedNewBlock = newBlock.replace(/\n+$/, '');
		const eofSplit = normalizedNewBlock.split('\n');
		const lastLine = eofSplit[eofSplit.length - 1] ?? '';
		const blockIdOnlyMatch = lastLine.match(/^\^([a-zA-Z0-9-]+)$/);

		if (blockIdOnlyMatch) {
			const blockId = blockIdOnlyMatch[1];
			eofSplit.pop();
			const baseText = eofSplit.join('\n').replace(/\s+$/, '');
			normalizedNewBlock = baseText + (baseText ? ' ' : '') + `^${blockId}`;
		}

		return content.substring(0, blockStart) + normalizedNewBlock;
	}

	if (isAllowedAfterBlockID(nextNonEmptyLine)) {
		if (/^\n/.test(afterBlock)) {
			return content.substring(0, blockStart) + newBlock + afterBlock;
		}
		return content.substring(0, blockStart) + newBlock + '\n' + afterBlock;
	}

	if (/^\n\n/.test(afterBlock)) {
		return content.substring(0, blockStart) + newBlock + afterBlock;
	}

	if (/^\n/.test(afterBlock)) {
		return content.substring(0, blockStart) + newBlock + '\n' + afterBlock;
	}

	return content.substring(0, blockStart) + newBlock + '\n\n' + afterBlock;
}

const findFirstH4Heading = (content: string, selection: string): string | null => {
	const selectionIndex = content.indexOf(selection);
	if (selectionIndex === -1) return null;

	const contentBeforeSelection = content.substring(0, selectionIndex);
	const h4Regex = /^####\s+(.+?)\.*$/gm;
	const matches = [...contentBeforeSelection.matchAll(h4Regex)];
	const lastMatch = matches[matches.length - 1];
	return lastMatch ? lastMatch[1].trim() : null;
};

const updateZoteroFrontmatter = async (
	app: App,
	settings: BlockCollectionsSettings,
	currentFile: TFile,
	selection: string,
	authorTitle: string | null
) => {
	const zoteroRegex = /items\/([A-Z0-9]{6,10}).*?annotation=([A-Z0-9]{6,10})/g;
	const matches = [...selection.matchAll(zoteroRegex)];

	if (matches.length === 0 || !authorTitle) return;

	const authorKey = settings.zoteroAuthorTitleKey;
	const itemIdKey = settings.zoteroItemIdKey;
	const pendingFrontmatterChanges: {
		[key: string]: string[];
	} = {
		[authorKey]: [authorTitle],
		[itemIdKey]: []
	};

	matches.forEach(match => {
		const itemId = match[1];
		if (!pendingFrontmatterChanges[itemIdKey].includes(itemId)) {
			pendingFrontmatterChanges[itemIdKey].push(itemId);
		}
	});

	await app.fileManager.processFrontMatter(currentFile, frontmatter => {
		if (!frontmatter[authorKey]) frontmatter[authorKey] = [];
		pendingFrontmatterChanges[authorKey].forEach(title => {
			if (!frontmatter[authorKey].includes(title)) frontmatter[authorKey].push(title);
		});

		if (!frontmatter[itemIdKey]) frontmatter[itemIdKey] = [];
		pendingFrontmatterChanges[itemIdKey].forEach(id => {
			if (!frontmatter[itemIdKey].includes(id)) frontmatter[itemIdKey].push(id);
		});

		frontmatter.date_modified = moment().format('YYYY-MM-DDTHH:mm');
		return frontmatter;
	});
};

class BlockIdChoiceModal extends Modal {
	onChoose: (type: 'random' | 'date') => void;
	private cleanupFunctions: (() => void)[] = [];

	constructor(app: App, onChoose: (type: 'random' | 'date') => void) {
		super(app);
		this.onChoose = onChoose;
	}

	onOpen() {
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: 'Choose Block ID Type' });
		const desc = this.contentEl.createEl('div', { text: 'How should the block ID be generated?' });
		desc.style.marginBottom = '1em';
		const btnRow = this.contentEl.createDiv();
		btnRow.style.display = 'flex';
		btnRow.style.gap = '1em';
		btnRow.style.justifyContent = 'center';
		const randomBtn = btnRow.createEl('button', { text: 'General Purpose (Random)' });
		randomBtn.style.padding = '0.5em 1.5em';
		randomBtn.onclick = () => {
			this.close();
			this.onChoose('random');
		};
		const dateBtn = btnRow.createEl('button', { text: 'Collections (YYMMDD)' });
		dateBtn.style.padding = '0.5em 1.5em';
		dateBtn.onclick = () => {
			this.close();
			this.onChoose('date');
		};
	}

	onClose() {
		this.cleanupFunctions.forEach(cleanup => cleanup());
		this.cleanupFunctions = [];
		this.contentEl.empty();
	}
}

interface CollectionBlockIdMatch {
	collection: string;
	blockId: string;
	files: string[];
}

class EnhancedDatePickerModal extends Modal {
	onSubmit: (date: string) => void;
	defaultDate: string;
	private cleanupFunctions: (() => void)[] = [];
	private canvasData: any;
	private collectionBlockIdMap: Map<string, CollectionBlockIdMatch>;
	private searchInput!: HTMLInputElement;
	private resultsContainer!: HTMLElement;
	private initialTab: 'search' | 'date';
	private getCanvasPath: () => string;
	private settings: BlockCollectionsSettings;

	constructor(
		app: App,
		defaultDate: string,
		onSubmit: (date: string) => void,
		getCanvasPath: () => string,
		initialTab: 'search' | 'date' = 'search',
		settings: BlockCollectionsSettings = DEFAULT_SETTINGS
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.defaultDate = defaultDate;
		this.collectionBlockIdMap = new Map();
		this.initialTab = initialTab;
		this.getCanvasPath = getCanvasPath;
		this.settings = settings;
	}

	async loadCanvasData() {
		const canvasFile = this.app.vault.getAbstractFileByPath(this.getCanvasPath());
		if (!(canvasFile instanceof TFile)) return;

		const content = await this.app.vault.read(canvasFile);
		this.canvasData = parseCanvasContent(content);

		this.canvasData.nodes.forEach((node: any) => {
			if (node.type === 'group') {
				const nodesInGroup = this.canvasData.nodes.filter((n: any) => {
					return (
						n.x >= node.x &&
						n.x + n.width <= node.x + node.width &&
						n.y >= node.y &&
						n.y + n.height <= node.y + node.height &&
						n.id !== node.id
					);
				});

				nodesInGroup.forEach((subNode: any) => {
					if (!subNode.text) return;
					const labelMatch = subNode.text.match(/label: (.*?)\n/);
					const blockIdMatch = subNode.text.match(/Block ([0-9]{6})/);
					const fileLinks = subNode.text.match(/\[\[(.*?)(?:#\^.*?)?\]\]/g);

					if (labelMatch && blockIdMatch && fileLinks) {
						const collection = labelMatch[1];
						const blockId = blockIdMatch[1];
						const files = fileLinks
							.map((link: string) => {
								const m = link.match(/\[\[(.*?)(?:#\^.*?)?\]\]/);
								return m ? m[1] : '';
							})
							.filter(Boolean);

						this.collectionBlockIdMap.set(collection, { collection, blockId, files });
					}
				});
				return;
			}

			if (!node.text) return;
			const labelMatch = node.text.match(/label: (.*?)\n/);
			const blockIdMatch = node.text.match(/Block ([0-9]{6})/);
			const fileLinks = node.text.match(/\[\[(.*?)(?:#\^.*?)?\]\]/g);
			if (!labelMatch || !blockIdMatch || !fileLinks) return;

			const collection = labelMatch[1];
			const blockId = blockIdMatch[1];
			const files = fileLinks
				.map((link: string) => {
					const m = link.match(/\[\[(.*?)(?:#\^.*?)?\]\]/);
					return m ? m[1] : '';
				})
				.filter(Boolean);

			this.collectionBlockIdMap.set(collection, { collection, blockId, files });
		});
	}

	async onOpen() {
		const modalEl = this.modalEl;
		modalEl.style.width = CONFIG.blockIdModal.width;
		modalEl.style.maxHeight = CONFIG.blockIdModal.maxHeight;
		modalEl.style.overflowY = 'auto';

		await this.loadCanvasData();
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: 'Choose Block ID' });

		const tabsContainer = this.contentEl.createEl('div', { cls: 'nav-buttons-container' });
		tabsContainer.style.marginBottom = '1em';

		const searchContainer = this.contentEl.createEl('div');
		searchContainer.style.marginBottom = '1em';
		this.searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Search by collection, filename, or block ID...'
		});
		this.searchInput.style.width = '100%';
		this.searchInput.style.marginBottom = '0.5em';

		this.resultsContainer = this.contentEl.createEl('div');
		this.resultsContainer.style.maxHeight = CONFIG.blockIdModal.resultsContainer.maxHeight;
		this.resultsContainer.style.overflowY = 'auto';

		const datePickerContainer = this.contentEl.createEl('div');
		datePickerContainer.style.display = 'none';
		const dateInput = datePickerContainer.createEl('input', { type: 'date' });
		const yyyy = '20' + this.defaultDate.slice(0, 2);
		const mm = this.defaultDate.slice(2, 4);
		const dd = this.defaultDate.slice(4, 6);
		dateInput.value = `${yyyy}-${mm}-${dd}`;
		dateInput.style.width = '100%';
		dateInput.style.marginBottom = '1em';

		const createNewBtn = tabsContainer.createEl('button', { text: 'Create New' });
		createNewBtn.style.margin = '0 auto';
		createNewBtn.style.display = 'block';

		createNewBtn.onclick = () => {
			if (createNewBtn.classList.contains('is-active')) {
				// Toggle back to search
				createNewBtn.classList.remove('is-active');
				searchContainer.style.display = 'block';
				this.resultsContainer.style.display = 'block';
				datePickerContainer.style.display = 'none';
				this.searchInput.focus();
			} else {
				createNewBtn.classList.add('is-active');
				searchContainer.style.display = 'none';
				this.resultsContainer.style.display = 'none';
				datePickerContainer.style.display = 'block';
				dateInput.focus();
			}
		};

		this.searchInput.addEventListener('input', () => {
			this.performSearch(this.searchInput.value);
		});

		const dateSubmitBtn = datePickerContainer.createEl('button', { text: 'Use This Date', cls: 'mod-cta' });
		dateSubmitBtn.onclick = async () => {
			if (!dateInput.value) return;
			const [year, month, day] = dateInput.value.split('-');
			const pickedDate = year.slice(-2) + month + day;

			const existingCollection = await findCollectionValueByBlockId(this.app, this.settings, pickedDate);
			if (existingCollection) {
				new Notice(`ℹ️ Block ID ${pickedDate} is already used by collection: "${existingCollection}"`, 6000);
			}

			this.onSubmit(pickedDate);
			super.close();
		};

		if (this.initialTab === 'date') createNewBtn.click();
	}

	async performSearch(query: string) {
		this.resultsContainer.empty();
		if (query.length < 2) return;

		const results = new Set<CollectionBlockIdMatch>();
		const queryLower = query.toLowerCase();

		this.collectionBlockIdMap.forEach(match => {
			if (
				match.collection.toLowerCase().includes(queryLower) ||
				match.blockId.includes(queryLower) ||
				match.files.some(file => file.toLowerCase().includes(queryLower))
			) {
				results.add(match);
			}
		});

		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			if (!file.basename.toLowerCase().includes(queryLower)) continue;
			const cache = this.app.metadataCache.getCache(file.path);
			if (!cache?.frontmatter?.collection) continue;

			const collections = Array.isArray(cache.frontmatter.collection)
				? cache.frontmatter.collection
				: [cache.frontmatter.collection];

			collections.forEach(collection => {
				const match = this.collectionBlockIdMap.get(collection);
				if (match) results.add(match);
			});
		}

		results.forEach(match => {
			const resultDiv = this.resultsContainer.createEl('div', { cls: 'search-result' });
			resultDiv.style.cssText =
				'padding: 8px; margin-bottom: 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px; display: flex; flex-direction: column;';

			const topSection = resultDiv.createEl('div', { cls: 'search-result-top' });
			topSection.style.cssText =
				'padding-bottom: 8px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer;';

			topSection.createEl('div', { text: `Collection: ${match.collection}`, cls: 'search-result-title' }).style.fontWeight =
				'bold';
			topSection.createEl('div', { text: `Block ID: ${match.blockId}`, cls: 'search-result-blockid' }).style.color =
				'var(--text-muted)';

			topSection.addEventListener('click', () => {
				this.onSubmit(match.blockId);
				super.close();
			});

			topSection.addEventListener('mouseenter', () => {
				topSection.style.backgroundColor = 'var(--background-modifier-hover)';
			});
			topSection.addEventListener('mouseleave', () => {
				topSection.style.backgroundColor = '';
			});

			const bottomSection = resultDiv.createEl('div', { cls: 'search-result-files' });
			bottomSection.style.cssText =
				'padding-top: 8px; display: flex; flex-direction: column; gap: 4px;';

			match.files.forEach(fileName => {
				const fileLink = bottomSection.createEl('div', { cls: 'file-link' });
				fileLink.style.cssText =
					'padding: 2px 4px; border-radius: 3px; cursor: pointer; color: var(--link-color);';

				const isMatchingFile = fileName.toLowerCase().includes(queryLower);
				if (isMatchingFile) {
					fileLink.style.backgroundColor = CONFIG.styling.fileHighlight.backgroundColor;
					fileLink.style.fontWeight = CONFIG.styling.fileHighlight.fontWeight;
				}

				const linkText = fileLink.createEl('span', { text: fileName });

				fileLink.addEventListener('click', async e => {
					e.stopPropagation();

					const file = this.app.vault.getFiles().find(f => {
						return f.basename.toLowerCase() === fileName.toLowerCase() || f.path.toLowerCase() === `${fileName.toLowerCase()}.md`;
					});

					if (!file) return;

					const leaf = this.app.workspace.getLeaf((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey);
					await leaf.openFile(file);

					setTimeout(async () => {
						const view = leaf.view as any;
						const editor = view?.editor as Editor | undefined;
						if (!editor) return;

						const content = await this.app.vault.read(file);
						const lines = content.split('\n');
						const blockIdLine = lines.findIndex(line => line.includes(`^${match.blockId}`));
						if (blockIdLine === -1) return;

						editor.setCursor(blockIdLine);
						editor.scrollIntoView({ from: { line: blockIdLine, ch: 0 }, to: { line: blockIdLine, ch: 0 } }, true);
					}, 100);
				});

				fileLink.addEventListener('mouseenter', () => {
					fileLink.style.backgroundColor = 'var(--background-modifier-hover)';
					linkText.style.textDecoration = 'underline';
				});

				fileLink.addEventListener('mouseleave', () => {
					fileLink.style.backgroundColor = isMatchingFile ? CONFIG.styling.fileHighlight.backgroundColor : '';
					linkText.style.textDecoration = 'none';
				});
			});
		});

		if (results.size === 0) {
			this.resultsContainer.createEl('div', { text: 'No matches found', cls: 'search-no-results' }).style.color = 'var(--text-muted)';
		}
	}

	onClose() {
		this.cleanupFunctions.forEach(cleanup => cleanup());
		this.cleanupFunctions = [];
		this.contentEl.empty();
	}
}

class BlockIdCopyChoiceModal extends Modal {
	blockId: string;
	file: TFile;
	onChoose: (type: 'wikilink' | 'uri') => void;
	private cleanupFunctions: (() => void)[] = [];

	constructor(app: App, file: TFile, blockId: string, onChoose: (type: 'wikilink' | 'uri') => void) {
		super(app);
		this.file = file;
		this.blockId = blockId;
		this.onChoose = onChoose;
	}

	onOpen() {
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: 'Copy Block Link' });
		const previewWikilink = `![[${this.file.basename}#^${this.blockId}]]`;
		const vaultName = this.app.vault.getName();
		let filePath = this.file.path;
		if (filePath.endsWith('.md')) filePath = filePath.slice(0, -3);
		const uri = `[${this.file.basename}](obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}%23%5E${this.blockId})`;

		const previewDiv = this.contentEl.createDiv();
		previewDiv.style.marginBottom = '1em';
		previewDiv.createEl('div', { text: 'Wikilink:' });
		const wikilinkInput = previewDiv.createEl('input', { type: 'text', value: previewWikilink, attr: { readonly: '' } });
		wikilinkInput.style.width = '100%';
		previewDiv.createEl('div', { text: 'Obsidian URI:' });
		const uriInput = previewDiv.createEl('input', { type: 'text', value: uri, attr: { readonly: '' } });
		uriInput.style.width = '100%';

		const btnRow = this.contentEl.createDiv();
		btnRow.style.display = 'flex';
		btnRow.style.gap = '1em';
		btnRow.style.justifyContent = 'center';
		const wikilinkBtn = btnRow.createEl('button', { text: 'Copy Wikilink' });
		wikilinkBtn.onclick = () => {
			this.onChoose('wikilink');
			this.close();
		};
		const uriBtn = btnRow.createEl('button', { text: 'Copy URI Link' });
		uriBtn.onclick = () => {
			this.onChoose('uri');
			this.close();
		};
	}

	onClose() {
		this.cleanupFunctions.forEach(cleanup => cleanup());
		this.cleanupFunctions = [];
		this.contentEl.empty();
	}
}

const isHoverEditor = (leaf: any): boolean => {
	if (!leaf) return false;
	const leafContainer = leaf.containerEl;
	return (
		leafContainer?.closest('.hover-popover') !== null ||
		leafContainer?.classList.contains('popover') ||
		leafContainer?.closest('.popover') !== null ||
		leaf.containerEl?.parentElement?.classList.contains('popover') ||
		!leaf.app.workspace.rootSplit.containerEl.contains(leafContainer) ||
		leaf.isHover === true ||
		leafContainer?.closest('.workspace-leaf.mod-active')?.closest('.workspace') === null
	);
};

const handleHoverEditor = async (
	app: App,
	currentFile: TFile,
	editor: Editor
): Promise<{ newEditor: Editor; newLeaf: any } | null> => {
	try {
		const cursorPos = editor.getCursor();
		const selectionFrom = editor.getCursor('from');
		const selectionTo = editor.getCursor('to');
		const selection = editor.getSelection();
		const hasSelection = selection.length > 0;

		const hoverLeaf = app.workspace.activeLeaf;
		if (hoverLeaf) hoverLeaf.detach();

		const newLeaf = app.workspace.getLeaf(true);
		await newLeaf.openFile(currentFile);
		await new Promise(resolve => setTimeout(resolve, 350));

		const newEditor = (newLeaf.view as any)?.editor as Editor | undefined;
		if (!newEditor) {
			new Notice('Failed to open file in new tab');
			return null;
		}

		await new Promise(resolve => setTimeout(resolve, 250));

		if (hasSelection) newEditor.setSelection(selectionFrom, selectionTo);
		else newEditor.setCursor(cursorPos);

		newEditor.scrollIntoView({ from: { line: cursorPos.line, ch: 0 }, to: { line: cursorPos.line, ch: 0 } }, true);
		newEditor.focus();

		new Notice('File opened in new tab. Hover editor closed.');
		return { newEditor, newLeaf };
	} catch (error) {
		console.error('Error handling hover editor:', error);
		new Notice('Failed to handle hover editor. Please try again in the main editor.');
		return null;
	}
};

const sanitizeFilename = (app: App, filename: string): string => {
	return app.metadataCache.getFirstLinkpathDest(filename, '')?.basename || filename;
};

const parseCollectionValue = (value: string, parseSpaces = false): string[] => {
	const splitValue = parseSpaces
		? value.split(/[,\s]+/)
		: value.split(',');

	return splitValue
		.map(term => term.trim())
		.map(term => term.replace(/\([^)]*\)/g, '').trim().toLowerCase())
		.filter(term => term.length > 0);
};

const resolveCanvasPath = (app: App, settings: BlockCollectionsSettings): TFile | null => {
	let relativePath = settings.canvasRelativePath?.trim() || CONFIG.canvas.relativePathFallback;

	// Normalize: remove leading/trailing slashes, ensure .canvas extension
	relativePath = relativePath.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
	if (!relativePath.endsWith('.canvas')) relativePath += '.canvas';
	relativePath = relativePath.replace(/\\/g, '/');

	let file = app.vault.getAbstractFileByPath(relativePath) as TFile;

	// Try fallback locations
	if (!file) {
		const fallbacks = [
			relativePath.toLowerCase(),
			relativePath.replace(/\//g, '\\'),
		];
		for (const path of fallbacks) {
			file = app.vault.getAbstractFileByPath(path) as TFile;
			if (file) break;
		}
	}

	return file;
};

const normalizeCanvasData = (canvasData: any): any => {
	if (!canvasData) canvasData = {};
	if (!Array.isArray(canvasData.nodes)) canvasData.nodes = [];
	if (!Array.isArray(canvasData.edges)) canvasData.edges = [];
	return canvasData;
};

const parseCanvasContent = (content: string): any => {
	return normalizeCanvasData(content.trim() ? JSON.parse(content) : {});
};

const getBlockIdForCollection = async (app: App, settings: BlockCollectionsSettings, collectionValue: string): Promise<string | null> => {
	try {
		const canvasFile = resolveCanvasPath(app, settings);
		if (!canvasFile || !(canvasFile instanceof TFile)) return null;

		const content = await app.vault.read(canvasFile);
		const canvasData = parseCanvasContent(content);

		for (const node of canvasData.nodes) {
			if (!node.text) continue;
			const labelMatch = node.text.match(/label: (.*?)\n/);
			const blockIdMatch = node.text.match(/Block ([0-9]{6})/);
			if (labelMatch && blockIdMatch && labelMatch[1] === collectionValue) {
				return blockIdMatch[1];
			}
		}
		return null;
	} catch (error) {
		console.error('Error getting block ID for collection:', error);
		return null;
	}
};

const findExistingCard = (canvasData: any, collectionValue: string) => {
	return canvasData.nodes.findIndex((node: any) => node.type === 'text' && node.text && node.text.includes(`label: ${collectionValue}\n`));
};

const getExistingCardFiles = (cardText: string): string[] => {
	const files: string[] = [];
	const lines = cardText.split('\n');
	for (const line of lines) {
		const match = line.match(/\[\[(.*?)(?:#\^.*?)?\]\]/);
		if (match && match[1]) files.push(match[1].trim());
	}
	return files;
};

const findSimilarCards = (canvasData: any, collectionValue: string): string[] => {
	const similar: string[] = [];
	canvasData.nodes.forEach((node: any) => {
		if (!node.text) return;
		const labelMatch = node.text.match(/label: (.*?)\n/);
		if (!labelMatch) return;
		const existingLabel = labelMatch[1];
		if (existingLabel === collectionValue) return;
		const terms1 = existingLabel.toLowerCase().split(',').map((t: string) => t.trim());
		const terms2 = collectionValue.toLowerCase().split(',').map((t: string) => t.trim());
		if (terms1.some(t1 => terms2.some(t2 => t1.includes(t2) || t2.includes(t1)))) similar.push(existingLabel);
	});
	return similar;
};

const validateExistingFiles = (app: App, files: string[]): string[] => {
	return files.filter(filename => {
		let file = app.vault.getAbstractFileByPath(filename + '.md');
		if (!file) file = app.vault.getAbstractFileByPath(filename);
		if (!file) file = app.vault.getMarkdownFiles().find(f => f.basename === filename);
		return file !== null;
	});
};

interface Position {
	x: number;
	y: number;
}

const findOptimalPosition = (canvasData: any, cardWidth: number, cardHeight: number): Position => {
	const layout = CONFIG.canvas.layout;
	void cardHeight;
	const targetColumn = cardWidth > layout.standardWidth ? layout.columns.wide[0] : layout.columns.standard[4];
	let lowestY = layout.startY;

	canvasData.nodes.forEach((node: any) => {
		if (node.type === 'group') return;
		if (Math.abs(node.x - targetColumn) < 10) {
			const bottom = node.y + node.height + layout.spacing.yGap;
			lowestY = Math.max(lowestY, bottom);
		}
	});

	return { x: targetColumn, y: lowestY };
};

const determineCardWidth = (collectionValue: string): number => {
	return collectionValue.length > 35 ? CONFIG.canvas.layout.wideWidth : CONFIG.canvas.layout.standardWidth;
};

const calculateNodeHeight = (filesCount: number): number => {
	const spacing = CONFIG.canvas.layout.spacing;
	const baseHeight = 120;
	const listHeight = filesCount * spacing.lineHeight;
	const urlBuffer = filesCount > 8 ? 90 : 40;
	const padding = spacing.cardPadding * 2;
	return baseHeight + listHeight + urlBuffer + padding;
};

const createCanvasNode = (app: App, files: string[], collectionValue: string, blockIdDate: string, canvasData: any, settings: BlockCollectionsSettings) => {
	const triggerId1 = 'trigger-' + Math.random().toString(36).substring(2, 5);
	const triggerId2 = 'trigger-' + Math.random().toString(36).substring(2, 5);

	const searchTerms = parseCollectionValue(collectionValue, settings.parseSpacesAsTerms);
	const sanitizedFiles = files.map(f => sanitizeFilename(app, f));
	const encodedFiles = sanitizedFiles.map(f => encodeURIComponent(f)).join('%7C');
	const encodedSearchTerms = searchTerms.join('%7C');
	const searchLink1 = `obsidian://search?&query=file%3A%20%2F%5E(${encodedFiles})%5C.md%2F%20%2F(${encodedSearchTerms})%2F`;
	const dateBlockId = blockIdDate;
	const searchLink2 = `obsidian://search?query=file%3A%20%2F%5E(${encodedFiles})%5C.md%2F%20block%3A%20${dateBlockId}`;
	const wikilinks = sanitizedFiles.map(f => `- [[${f}#^${dateBlockId}]]`).join('\n');
	const contentHeight = calculateNodeHeight(sanitizedFiles.length);

	const nodeText = [
		'```meta-bind-button',
		'style: primary',
		`label: ${collectionValue}`,
		`id: ${triggerId1}`,
		'action:',
		'  type: open',
		`  link: ${searchLink1}`,
		'```',
		'```meta-bind-button',
		'style: default',
		`label: Block ${dateBlockId}`,
		`id: ${triggerId2}`,
		'action:',
		'  type: open',
		`  link: ${searchLink2}`,
		'```',
		wikilinks
	].join('\n');

	const cardWidth = determineCardWidth(collectionValue);
	const position = findOptimalPosition(canvasData, cardWidth, contentHeight);

	return {
		id: Date.now().toString(36),
		type: 'text',
		text: nodeText,
		styleAttributes: {},
		extra: 'cs-extra',
		bg: 'cs-bg-gradient',
		x: position.x,
		y: position.y,
		width: cardWidth,
		height: contentHeight
	};
};

const preserveExistingCardStyling = (existingNode: any, newNode: any) => {
	if (!existingNode || !newNode) return;

	const preservedProps = ['color', 'bg', 'border', 'highlight', 'extra'];
	for (const prop of preservedProps) {
		if (existingNode[prop] !== undefined) newNode[prop] = existingNode[prop];
	}

	if (existingNode.styleAttributes !== undefined) {
		newNode.styleAttributes = existingNode.styleAttributes;
	}
};

const updateCanvasFile = async (
	app: App,
	settings: BlockCollectionsSettings,
	newFiles: string[],
	collectionValue: string,
	blockIdDate: string
) => {
	try {
		const canvasFile = resolveCanvasPath(app, settings);
		if (!canvasFile || !(canvasFile instanceof TFile)) throw new Error('Canvas file not found');

		const content = await app.vault.read(canvasFile);
		const canvasData = parseCanvasContent(content);

		const similarCards = findSimilarCards(canvasData, collectionValue);
		if (similarCards.length > 0) new Notice(`Similar collections found: ${similarCards.join(', ')}`, 5000);

		const existingCardIndex = findExistingCard(canvasData, collectionValue);
		const hadExistingCard = existingCardIndex !== -1;
		const existingNode = hadExistingCard ? canvasData.nodes[existingCardIndex] : undefined;
		const preservedX = hadExistingCard ? existingNode.x : undefined;
		const preservedY = hadExistingCard ? existingNode.y : undefined;

		const uniqueFiles = new Set(newFiles.map(f => sanitizeFilename(app, f)));

		if (hadExistingCard) {
			const existingFiles = getExistingCardFiles(canvasData.nodes[existingCardIndex].text);
			const validExistingFiles = validateExistingFiles(app, existingFiles);
			validExistingFiles.forEach(file => uniqueFiles.add(sanitizeFilename(app, file)));
			canvasData.nodes.splice(existingCardIndex, 1);
			const removedCount = existingFiles.length - validExistingFiles.length;
			if (removedCount > 0) new Notice(`Removed ${removedCount} missing files from collection`, 3000);
		}

		const allFiles = Array.from(uniqueFiles).sort((a, b) => a.localeCompare(b, 'hu', { sensitivity: 'base' }));
		const newNode = createCanvasNode(app, allFiles, collectionValue, blockIdDate, canvasData, settings);
		if (hadExistingCard && existingNode) preserveExistingCardStyling(existingNode, newNode);
		if (hadExistingCard && preservedX !== undefined && preservedY !== undefined) {
			newNode.x = preservedX;
			newNode.y = preservedY;
		}

		canvasData.nodes.push(newNode);
		await app.vault.modify(canvasFile, JSON.stringify(canvasData, null, 2));
		return true;
	} catch (error) {
		console.error('Error updating canvas file:', error);
		return false;
	}
};

const findCollectionValueByBlockId = async (app: App, settings: BlockCollectionsSettings, blockId: string): Promise<string | null> => {
	try {
		const canvasFile = resolveCanvasPath(app, settings);
		if (!canvasFile || !(canvasFile instanceof TFile)) throw new Error('Canvas file not found');

		const content = await app.vault.read(canvasFile);
		const canvasData = parseCanvasContent(content);

		for (const node of canvasData.nodes) {
			if (!node.text) continue;
			if (node.text.includes(`block%3A%20${blockId}`) || node.text.includes(`Block ${blockId}`)) {
				const labelMatch = node.text.match(/style: primary\nlabel: (.*?)\n/);
				if (labelMatch && labelMatch[1]) return labelMatch[1];
			}
		}

		return null;
	} catch (error) {
		console.error('Error finding collection value by block ID:', error);
		return null;
	}
};

async function getExistingCollections(app: App): Promise<string[]> {
	const collections = new Set<string>();
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		const cache = app.metadataCache.getCache(file.path);
		if (cache?.frontmatter?.collection) {
			const value = cache.frontmatter.collection;
			if (Array.isArray(value)) {
				value.forEach(v => typeof v === 'string' && collections.add(v.trim()));
			} else if (typeof value === 'string') {
				collections.add(value.trim());
			}
		}
	}

	return Array.from(collections).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

async function getExistingPlantUMLNodesAndCollections(app: App, settings: BlockCollectionsSettings): Promise<string[]> {
	const values = new Set<string>();
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		const cache = app.metadataCache.getCache(file.path);
		if (!cache?.frontmatter) continue;

		if (cache.frontmatter.collection) {
			const collectionValue = cache.frontmatter.collection;
			if (Array.isArray(collectionValue)) collectionValue.forEach(v => typeof v === 'string' && values.add(v.trim()));
			else if (typeof collectionValue === 'string') values.add(collectionValue.trim());
		}

		const key = settings.plantUMLFrontmatterKey;
		if (cache.frontmatter[key]) {
			const plantumlNodesValue = cache.frontmatter[key];
			if (Array.isArray(plantumlNodesValue)) plantumlNodesValue.forEach(v => typeof v === 'string' && values.add(v.trim()));
			else if (typeof plantumlNodesValue === 'string') values.add(plantumlNodesValue.trim());
		}
	}

	return Array.from(values).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

class CollectionQueryInputModal extends Modal {
	onSubmitCollection: (result: string) => void;
	onSubmitCombined: (result: string) => void;
	private cleanupFunctions: (() => void)[] = [];
	private allCombinedValues: string[] = [];
	private allCollectionValues: string[] = [];
	private combinedFilterInput!: HTMLInputElement;
	private collectionFilterInput!: HTMLInputElement;
	private combinedList!: HTMLElement;
	private collectionList!: HTMLElement;
	private settings: BlockCollectionsSettings;

	constructor(
		app: App,
		settings: BlockCollectionsSettings,
		onSubmitCollection: (result: string) => void,
		onSubmitCombined: (result: string) => void
	) {
		super(app);
		this.settings = settings;
		this.onSubmitCollection = onSubmitCollection;
		this.onSubmitCombined = onSubmitCombined;
	}

	async onOpen() {
		const modalEl = this.modalEl;
		modalEl.style.maxWidth = '90vw';
		modalEl.style.maxHeight = '90vh';
		modalEl.style.zIndex = '1000';

		modalEl.style.width = CONFIG.querierModal.width;
		modalEl.style.height = CONFIG.querierModal.height;
		modalEl.style.minHeight = `min(${CONFIG.querierModal.height}, 90vh)`;
		modalEl.style.maxHeight = `min(${CONFIG.querierModal.height}, 90vh)`;

		if (window.innerWidth < 768) {
			modalEl.style.width = '90vw';
			modalEl.style.height = '80vh';
			modalEl.style.minHeight = '80vh';
			modalEl.style.maxWidth = 'calc(100% - 20px)';
			modalEl.style.maxHeight = 'calc(100% - 20px)';
		}

		modalEl.style.display = 'flex';
		modalEl.style.flexDirection = 'column';

		const contentEl = this.contentEl;
		contentEl.style.overflowY = 'auto';
		contentEl.style.maxHeight = `calc(min(${CONFIG.querierModal.height}, 90vh) - 80px)`;
		contentEl.style.minHeight = `calc(min(${CONFIG.querierModal.height}, 90vh) - 80px)`;
		contentEl.style.flexGrow = '1';

		if (this.settings.showPlantUML) {
			this.allCombinedValues = await getExistingPlantUMLNodesAndCollections(this.app, this.settings);
		}
		this.allCollectionValues = await getExistingCollections(this.app);

		if (this.settings.showPlantUML) {
			contentEl.createEl('h2', { text: 'PlantUML Nodes & Collection Query (on multiple results, go with single string)' });

			const combinedSearchContainer = contentEl.createEl('div');
			this.combinedFilterInput = combinedSearchContainer.createEl('input', {
				type: 'text',
				placeholder: CONFIG.queryDropdown.searchPlaceholder
			});
			this.combinedFilterInput.style.width = '100%';
			this.combinedFilterInput.style.height = CONFIG.queryDropdown.itemHeight;
			this.combinedFilterInput.style.padding = CONFIG.queryDropdown.padding;
			this.combinedFilterInput.style.marginBottom = '4px';
			this.combinedFilterInput.style.fontSize = CONFIG.queryDropdown.fontSize;

			this.combinedList = document.createElement('div');
			this.combinedList.className = 'collections-list';
			contentEl.appendChild(this.combinedList);
			this.combinedList.style.maxHeight = CONFIG.queryDropdown.maxHeight;
			this.combinedList.style.overflowY = 'auto';
			this.combinedList.style.border = '1px solid var(--background-modifier-border)';
			this.combinedList.style.borderRadius = CONFIG.queryDropdown.borderRadius;
			this.combinedList.style.marginBottom = CONFIG.queryDropdown.marginBottom;

			this.renderCombinedOptions();
			this.combinedFilterInput.addEventListener('input', () => this.renderCombinedOptions(this.combinedFilterInput.value));

			const button2 = contentEl.createEl('button', { text: 'Search PlantUML + Collection' });
			button2.classList.add('mod-cta');
			button2.style.marginBottom = '1.5em';
			button2.onclick = () => {
				if (!this.combinedFilterInput.value.trim()) {
				new Notice('Please enter a value for PlantUML/Collection');
				return;
			}
				this.onSubmitCombined(this.combinedFilterInput.value.trim());
				this.onClose();
			};

			const keydownHandlerCombined = (e: KeyboardEvent) => {
				if (e.key === 'Enter') button2.click();
				if (e.key === 'Escape') this.onClose();
			};
			this.combinedFilterInput.addEventListener('keydown', keydownHandlerCombined);
			this.cleanupFunctions.push(() => this.combinedFilterInput.removeEventListener('keydown', keydownHandlerCombined));
		}

		contentEl.createEl('h2', { text: 'Collection Query Only', attr: { style: 'margin-top:1.5em;' } });
		const collectionSearchContainer = contentEl.createEl('div');
		this.collectionFilterInput = collectionSearchContainer.createEl('input', {
			type: 'text',
			placeholder: CONFIG.queryDropdown.searchPlaceholder
		});
		this.collectionFilterInput.style.width = '100%';
		this.collectionFilterInput.style.height = CONFIG.queryDropdown.itemHeight;
		this.collectionFilterInput.style.padding = CONFIG.queryDropdown.padding;
		this.collectionFilterInput.style.marginBottom = '4px';
		this.collectionFilterInput.style.fontSize = CONFIG.queryDropdown.fontSize;

		this.collectionList = document.createElement('div');
		this.collectionList.className = 'collections-list';
		contentEl.appendChild(this.collectionList);
		this.collectionList.style.maxHeight = CONFIG.queryDropdown.maxHeight;
		this.collectionList.style.overflowY = 'auto';
		this.collectionList.style.border = '1px solid var(--background-modifier-border)';
		this.collectionList.style.borderRadius = CONFIG.queryDropdown.borderRadius;
		this.collectionList.style.marginBottom = CONFIG.queryDropdown.marginBottom;

		this.renderCollectionOptions();
		this.collectionFilterInput.addEventListener('input', () => this.renderCollectionOptions(this.collectionFilterInput.value));

		const button1 = contentEl.createEl('button', { text: 'Search Collection' });
		button1.classList.add('mod-cta');
		button1.onclick = () => {
			if (!this.collectionFilterInput.value.trim()) {
			new Notice('Please enter a collection value');
			return;
		}
			this.onSubmitCollection(this.collectionFilterInput.value.trim());
			this.onClose();
		};

		const keydownHandlerCollection = (e: KeyboardEvent) => {
			if (e.key === 'Enter') button1.click();
			if (e.key === 'Escape') this.onClose();
		};
		this.collectionFilterInput.addEventListener('keydown', keydownHandlerCollection);
		this.cleanupFunctions.push(() => this.collectionFilterInput.removeEventListener('keydown', keydownHandlerCollection));

		if (this.settings.showPlantUML) this.combinedFilterInput.focus();
		else this.collectionFilterInput.focus();
	}

	private renderCombinedOptions(filterText: string = '') {
		if (!this.settings.showPlantUML) return;
		this.combinedList.innerHTML = '';
		const filterLower = filterText.toLowerCase();

		let filteredValues = this.allCombinedValues;
		if (filterText) {
			try {
				const regex = new RegExp(filterText, 'i');
				filteredValues = this.allCombinedValues.filter(value => regex.test(value));
			} catch {
				new Notice('Invalid regex, falling back to text search.');
				filteredValues = this.allCombinedValues.filter(value => value.toLowerCase().includes(filterLower));
			}
		}

		filteredValues.forEach(value => {
			const item = document.createElement('div');
			item.className = 'collection-item';
			item.textContent = value;
			this.combinedList.appendChild(item);

			item.style.boxSizing = 'border-box';
			item.style.padding = CONFIG.queryDropdown.padding;
			item.style.height = CONFIG.queryDropdown.itemHeight;
			item.style.lineHeight = CONFIG.queryDropdown.itemHeight;
			item.style.cursor = 'pointer';
			item.style.fontSize = CONFIG.queryDropdown.fontSize;
			item.style.backgroundColor = 'var(--background-modifier-form-field)';

			item.addEventListener('mouseenter', () => (item.style.backgroundColor = 'var(--background-modifier-hover)'));
			item.addEventListener('mouseleave', () => (item.style.backgroundColor = 'var(--background-modifier-form-field)'));
			item.addEventListener('click', () => {
				this.combinedFilterInput.value = value;
			});
		});
	}

	private renderCollectionOptions(filterText: string = '') {
		this.collectionList.innerHTML = '';
		const filterLower = filterText.toLowerCase();

		let filteredValues = this.allCollectionValues;
		if (filterText) {
			try {
				const regex = new RegExp(filterText, 'i');
				filteredValues = this.allCollectionValues.filter(value => regex.test(value));
			} catch {
				new Notice('Invalid regex, falling back to text search.');
				filteredValues = this.allCollectionValues.filter(value => value.toLowerCase().includes(filterLower));
			}
		}

		filteredValues.forEach(value => {
			const item = document.createElement('div');
			item.className = 'collection-item';
			item.textContent = value;
			this.collectionList.appendChild(item);

			item.style.boxSizing = 'border-box';
			item.style.padding = CONFIG.queryDropdown.padding;
			item.style.height = CONFIG.queryDropdown.itemHeight;
			item.style.lineHeight = CONFIG.queryDropdown.itemHeight;
			item.style.cursor = 'pointer';
			item.style.fontSize = CONFIG.queryDropdown.fontSize;
			item.style.backgroundColor = 'var(--background-modifier-form-field)';

			item.addEventListener('mouseenter', () => (item.style.backgroundColor = 'var(--background-modifier-hover)'));
			item.addEventListener('mouseleave', () => (item.style.backgroundColor = 'var(--background-modifier-form-field)'));
			item.addEventListener('click', () => {
				this.collectionFilterInput.value = value;
			});
		});
	}

	onClose() {
		this.cleanupFunctions.forEach(cleanup => cleanup());
		this.cleanupFunctions = [];
		this.contentEl.innerHTML = '';
		super.close();
	}
}

class CollectionInputModal extends Modal {
	onSubmit: (result: string) => void;
	private cleanupFunctions: (() => void)[] = [];
	initialValue: string;
	filterInput!: HTMLInputElement;
	renameFilterInput!: HTMLInputElement;
	collectionList!: HTMLElement;
	collections: string[];
	fileCollections: string[];
	fileCollectionBlockIds: Map<string, string>;
	renameList!: HTMLElement;
	removeList!: HTMLElement;
	removeFilterInput!: HTMLInputElement;
	private isRenameMode: boolean = false;
	private originalCollection: string = '';
	private settings: BlockCollectionsSettings;

	constructor(app: App, initialValue: string, onSubmit: (result: string) => void, settings: BlockCollectionsSettings) {
		super(app);
		this.onSubmit = onSubmit;
		this.initialValue = initialValue;
		this.collections = [];
		this.fileCollections = [];
		this.fileCollectionBlockIds = new Map();
		this.settings = settings;
	}

	async onOpen() {
		const modalEl = this.modalEl;
		modalEl.style.width = CONFIG.adderModal.width;
		modalEl.style.height = CONFIG.adderModal.height;
		modalEl.style.maxHeight = `min(${CONFIG.adderModal.height}, 90vh)`;
		modalEl.style.overflowY = 'auto';

		const contentEl = this.contentEl;

		// Add section title for adding new collection
		const addSectionTitle = contentEl.createEl('h3', { text: 'Add to Collection (New or Existing)' });
		addSectionTitle.style.padding = '0 8px';
		addSectionTitle.style.marginTop = '0';
		addSectionTitle.style.marginBottom = '8px';

		const description = contentEl.createEl('p', { text: ' Enter new value or select existing collection' });
		description.style.marginBottom = '0.5em';

		const inputContainer = contentEl.createEl('div', { cls: 'collection-input-container' });
		inputContainer.style.width = '100%';
		inputContainer.style.padding = '8px';

		const inputEl = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'value1, value2, value3',
			value: this.initialValue
		});
		inputEl.style.width = '100%';
		inputEl.style.height = '2.2em';
		inputEl.style.fontSize = '0.9em';
		inputEl.style.marginBottom = CONFIG.collectionDropdown.marginBottom;

		const collectionsSection = contentEl.createEl('div', { cls: 'collections-section' });
		collectionsSection.style.padding = '0 8px';

		const searchContainer = collectionsSection.createEl('div');
		this.filterInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: CONFIG.collectionDropdown.searchPlaceholder
		});
		this.filterInput.style.width = '100%';
		this.filterInput.style.height = CONFIG.collectionDropdown.itemHeight;
		this.filterInput.style.padding = CONFIG.collectionDropdown.padding;
		this.filterInput.style.marginBottom = '4px';
		this.filterInput.style.fontSize = CONFIG.collectionDropdown.fontSize;

		this.collectionList = collectionsSection.createEl('div', { cls: 'collections-list' });
		this.collectionList.style.maxHeight = CONFIG.collectionDropdown.maxHeight;
		this.collectionList.style.overflowY = 'auto';
		this.collectionList.style.border = '1px solid var(--background-modifier-border)';
		this.collectionList.style.borderRadius = CONFIG.collectionDropdown.borderRadius;
		this.collectionList.style.marginBottom = CONFIG.collectionDropdown.marginBottom;

		// Add Cancel/Add buttons here - between collections and rename sections
		const buttonContainer = contentEl.createEl('div', { cls: 'collection-button-container' });
		buttonContainer.style.marginTop = '1em';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.padding = '0 10px';
		buttonContainer.style.marginBottom = '12px';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		const submitButton = buttonContainer.createEl('button', { text: 'Add' });
		submitButton.addClass('mod-cta');

		cancelButton.onclick = () => this.close();
		submitButton.onclick = () => this.handleSubmit(inputEl.value);

		inputEl.addEventListener('keydown', e => {
			if (e.key === 'Enter') this.handleSubmit(inputEl.value);
			else if (e.key === 'Escape') this.close();
		});

		inputEl.focus();
		if (this.initialValue) inputEl.setSelectionRange(this.initialValue.length, this.initialValue.length);

		const renameSection = contentEl.createEl('div', { cls: 'rename-section' });
		renameSection.style.padding = '0 8px';
		renameSection.style.marginTop = '12px';
		renameSection.style.borderTop = '1px solid var(--background-modifier-border)';
		renameSection.style.paddingTop = '12px';
		renameSection.createEl('h3', { text: 'Rename Existing Collection' });

		const renameSearchContainer = renameSection.createEl('div');
		this.renameFilterInput = renameSearchContainer.createEl('input', {
			type: 'text',
			placeholder: CONFIG.collectionDropdown.searchPlaceholder
		});
		this.renameFilterInput.style.width = '100%';
		this.renameFilterInput.style.height = CONFIG.collectionDropdown.itemHeight;
		this.renameFilterInput.style.padding = CONFIG.collectionDropdown.padding;
		this.renameFilterInput.style.marginBottom = '4px';
		this.renameFilterInput.style.fontSize = CONFIG.collectionDropdown.fontSize;

		const renameContainer = renameSection.createEl('div');
		this.renameList = renameContainer.createEl('div', { cls: 'rename-collections-list' });
		this.renameList.style.maxHeight = CONFIG.collectionDropdown.maxHeight;
		this.renameList.style.overflowY = 'auto';
		this.renameList.style.border = '1px solid var(--background-modifier-border)';
		this.renameList.style.borderRadius = CONFIG.collectionDropdown.borderRadius;
		this.renameList.style.marginBottom = '8px';

		const removeSection = contentEl.createEl('div', { cls: 'remove-section' });
		removeSection.style.padding = '0 8px';
		removeSection.style.marginTop = '12px';
		removeSection.style.borderTop = '1px solid var(--background-modifier-border)';
		removeSection.style.paddingTop = '12px';
		removeSection.createEl('h3', { text: 'Remove File from Collection' });

		const removeSearchContainer = removeSection.createEl('div');
		this.removeFilterInput = removeSearchContainer.createEl('input', {
			type: 'text',
			placeholder: CONFIG.collectionDropdown.searchPlaceholder
		});
		this.removeFilterInput.style.width = '100%';
		this.removeFilterInput.style.height = CONFIG.collectionDropdown.itemHeight;
		this.removeFilterInput.style.padding = CONFIG.collectionDropdown.padding;
		this.removeFilterInput.style.marginBottom = '4px';
		this.removeFilterInput.style.fontSize = CONFIG.collectionDropdown.fontSize;

		this.removeList = removeSection.createEl('div', { cls: 'remove-collections-list' });
		this.removeList.style.maxHeight = CONFIG.collectionDropdown.maxHeight;
		this.removeList.style.overflowY = 'auto';
		this.removeList.style.border = '1px solid var(--background-modifier-border)';
		this.removeList.style.borderRadius = CONFIG.collectionDropdown.borderRadius;
		this.removeList.style.marginBottom = '8px';

		this.collections = await getExistingCollections(this.app);

		// Get current file's collections and their block IDs for the remove dropdown
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file) {
			const cache = this.app.metadataCache.getCache(activeView.file.path);
			if (cache?.frontmatter?.collection) {
				this.fileCollections = Array.isArray(cache.frontmatter.collection)
					? cache.frontmatter.collection
					: [cache.frontmatter.collection];
				
				// Fetch block IDs for each collection
				for (const collection of this.fileCollections) {
					const blockId = await getBlockIdForCollection(this.app, this.settings, collection);
					if (blockId) {
						this.fileCollectionBlockIds.set(collection, blockId);
					}
				}
			}
		}

		this.renderCollections();
		this.renderRenameOptions();
		this.renderRemoveOptions();

		this.filterInput.addEventListener('input', () => this.renderCollections(this.filterInput.value));
		this.renameFilterInput.addEventListener('input', () => this.renderRenameOptions(this.renameFilterInput.value));
		this.removeFilterInput.addEventListener('input', () => this.renderRemoveOptions(this.removeFilterInput.value));
	}

	private renderCollections(filter: string = '') {
		this.collectionList.innerHTML = '';
		const filterLower = filter.toLowerCase();

		this.collections
			.filter(collection => !filter || collection.toLowerCase().includes(filterLower))
			.forEach(collection => {
				const item = document.createElement('div');
				item.className = 'collection-item';
				item.textContent = collection;
				this.collectionList.appendChild(item);

				item.style.padding = CONFIG.collectionDropdown.padding;
				item.style.height = CONFIG.collectionDropdown.itemHeight;
				item.style.lineHeight = CONFIG.collectionDropdown.itemHeight;
				item.style.cursor = 'pointer';
				item.style.fontSize = CONFIG.collectionDropdown.fontSize;
				item.style.backgroundColor = 'var(--background-modifier-form-field)';

				item.addEventListener('mouseenter', () => (item.style.backgroundColor = 'var(--background-modifier-hover)'));
				item.addEventListener('mouseleave', () => (item.style.backgroundColor = 'var(--background-modifier-form-field)'));
				item.addEventListener('click', () => this.handleSubmit(collection));
			});
	}

	private renderRenameOptions(filter: string = '') {
		this.renameList.innerHTML = '';
		const filterLower = filter.toLowerCase();

		this.collections
			.filter(collection => !filter || collection.toLowerCase().includes(filterLower))
			.forEach(collection => {
				const item = document.createElement('div');
				item.className = 'rename-item';
				item.textContent = `Rename: ${collection}`;
				this.renameList.appendChild(item);

				item.style.padding = CONFIG.collectionDropdown.padding;
				item.style.height = CONFIG.collectionDropdown.itemHeight;
				item.style.lineHeight = CONFIG.collectionDropdown.itemHeight;
				item.style.cursor = 'pointer';
				item.style.fontSize = CONFIG.collectionDropdown.fontSize;
				item.style.backgroundColor = 'var(--background-modifier-form-field)';

				item.addEventListener('mouseenter', () => (item.style.backgroundColor = 'var(--background-modifier-hover)'));
				item.addEventListener('mouseleave', () => (item.style.backgroundColor = 'var(--background-modifier-form-field)'));
				item.addEventListener('click', () => this.handleRename(collection));
			});
	}

	private renderRemoveOptions(filter: string = '') {
		this.removeList.innerHTML = '';
		const filterLower = filter.toLowerCase();

		// Only show collections that the current file belongs to
		const collectionsToShow = this.fileCollections.length > 0 ? this.fileCollections : [];

		if (collectionsToShow.length === 0) {
			const emptyMsg = document.createElement('div');
			emptyMsg.textContent = 'No collections to remove (file not in any collection)';
			emptyMsg.style.padding = CONFIG.collectionDropdown.padding;
			emptyMsg.style.color = 'var(--text-muted)';
			emptyMsg.style.fontStyle = 'italic';
			this.removeList.appendChild(emptyMsg);
			return;
		}

		collectionsToShow
			.filter(collection => !filter || collection.toLowerCase().includes(filterLower))
			.forEach(collection => {
				const blockId = this.fileCollectionBlockIds.get(collection);
				const blockIdText = blockId ? ` (Block ${blockId})` : '';
				const item = document.createElement('div');
				item.className = 'remove-item';
				item.textContent = `Remove file from: ${collection}${blockIdText}`;
				this.removeList.appendChild(item);

				item.style.padding = CONFIG.collectionDropdown.padding;
				item.style.height = CONFIG.collectionDropdown.itemHeight;
				item.style.lineHeight = CONFIG.collectionDropdown.itemHeight;
				item.style.cursor = 'pointer';
				item.style.fontSize = CONFIG.collectionDropdown.fontSize;
				item.style.backgroundColor = 'var(--background-modifier-form-field)';

				item.addEventListener('mouseenter', () => (item.style.backgroundColor = 'var(--background-modifier-hover)'));
				item.addEventListener('mouseleave', () => (item.style.backgroundColor = 'var(--background-modifier-form-field)'));
				item.addEventListener('click', () => this.handleRemoveFileFromCollection(collection));
			});
	}

	private async handleRemoveFileFromCollection(collectionValue: string) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView?.file) {
			new Notice('No active file to remove from collection');
			return;
		}
		const file = activeView.file;

		await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
			if (Array.isArray(frontmatter.collection)) {
				frontmatter.collection = frontmatter.collection.filter((v: any) => v !== collectionValue);
				if (frontmatter.collection.length === 0) delete frontmatter.collection;
			} else if (frontmatter.collection === collectionValue) {
				delete frontmatter.collection;
			}
			return frontmatter;
		});

		const canvasFile = resolveCanvasPath(this.app, this.settings);
		if (!canvasFile || !(canvasFile instanceof TFile)) {
			new Notice(`Removed ${file.basename} from frontmatter, but canvas file not found`);
			this.close();
			return;
		}

		const content = await this.app.vault.read(canvasFile);
		const canvasData = parseCanvasContent(content);
		const cardIndex = findExistingCard(canvasData, collectionValue);

		if (cardIndex === -1) {
			new Notice(`Removed ${file.basename} from frontmatter, but canvas card not found`);
			this.close();
			return;
		}

		const cardNode = canvasData.nodes[cardIndex];
		const lines = cardNode.text.split('\n');
		const filteredLines = lines.filter((line: any) => !line.includes(`[[${file.basename}#^`));
		cardNode.text = filteredLines.join('\n');

		// Extract block ID before modifying card
		const blockIdMatch = cardNode.text.match(/Block ([0-9]{6})/);
		const blockId = blockIdMatch ? blockIdMatch[1] : null;

		const remainingFiles = getExistingCardFiles(cardNode.text);
		if (remainingFiles.length === 0) {
			canvasData.nodes.splice(cardIndex, 1);
			new Notice(`Removed ${file.basename} from collection. Card deleted (no files remaining).`);
		} else {
			if (blockId) {
				canvasData.nodes.splice(cardIndex, 1);
				const newNode = createCanvasNode(this.app, remainingFiles, collectionValue, blockId, canvasData, this.settings);
				newNode.x = cardNode.x;
				newNode.y = cardNode.y;
				canvasData.nodes.push(newNode);
			}
			new Notice(`Removed ${file.basename} from collection "${collectionValue}"`);
		}

		await this.app.vault.modify(canvasFile, JSON.stringify(canvasData, null, 2));

		// Also remove the block ID from the file content itself
		if (blockId) {
			try {
				const fileContent = await this.app.vault.read(file);
				// Remove the block ID from the content
				const blockIdPattern = new RegExp(`\\s?\\^${blockId}\\b`, 'g');
				const newContent = fileContent.replace(blockIdPattern, '');
				if (newContent !== fileContent) {
					await this.app.vault.modify(file, newContent);
				}
			} catch (error) {
				console.error('Error removing block ID from file:', error);
			}
		}

		this.close();
	}

	private handleRename(oldCollection: string) {
		this.isRenameMode = true;
		this.originalCollection = oldCollection;
		this.renderRenameInterface();
	}

	private renderRenameInterface() {
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: `Rename Collection: "${this.originalCollection}"` });
		const description = this.contentEl.createEl('p', { text: 'Enter new collection name' });
		description.style.marginBottom = '1em';

		const inputContainer = this.contentEl.createEl('div', { cls: 'rename-input-container' });
		inputContainer.style.width = '100%';
		inputContainer.style.padding = '10px';

		const renameInput = inputContainer.createEl('input', { type: 'text', value: this.originalCollection });
		renameInput.style.width = '100%';
		renameInput.style.height = '2.5em';
		renameInput.style.fontSize = '1em';
		renameInput.style.marginBottom = '16px';

		const buttonContainer = this.contentEl.createEl('div', { cls: 'collection-button-container' });
		buttonContainer.style.marginTop = '1em';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.padding = '0 10px';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		const submitButton = buttonContainer.createEl('button', { text: 'Rename' });
		submitButton.addClass('mod-cta');

		cancelButton.onclick = () => {
			this.isRenameMode = false;
			this.originalCollection = '';
			this.onOpen();
		};

		submitButton.onclick = () => {
			const newValue = renameInput.value.trim();
			if (!newValue || newValue === this.originalCollection) {
				new Notice('Please enter a different collection name');
				return;
			}
			this.performRename(this.originalCollection, newValue);
			this.close();
		};

		renameInput.addEventListener('keydown', e => {
			if (e.key === 'Enter') submitButton.click();
			else if (e.key === 'Escape') cancelButton.click();
		});

		renameInput.focus();
		renameInput.select();
	}

	private handleSubmit(value: string) {
		const trimmedValue = value.trim();
		if (!trimmedValue) {
			new Notice('Please enter at least one value');
			return;
		}
		this.onSubmit(trimmedValue);
		this.close();
	}

	private async performRename(oldCollection: string, newCollection: string) {
		let updatedFiles = 0;
		let errors = 0;

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const cache = this.app.metadataCache.getCache(file.path);
			if (cache?.frontmatter?.collection) {
				const collections = Array.isArray(cache.frontmatter.collection)
					? cache.frontmatter.collection
					: [cache.frontmatter.collection];

				if (collections.includes(oldCollection)) {
					try {
						await this.app.fileManager.processFrontMatter(file, frontmatter => {
							if (Array.isArray(frontmatter.collection)) {
								const index = frontmatter.collection.indexOf(oldCollection);
								if (index !== -1) frontmatter.collection[index] = newCollection;
							} else if (frontmatter.collection === oldCollection) {
								frontmatter.collection = newCollection;
							}
							return frontmatter;
						});
						updatedFiles++;
					} catch (error) {
						console.error(`Error updating ${file.path}:`, error);
						errors++;
					}
				}
			}
		}

		const canvasUpdated = await this.updateCanvasForRename(oldCollection, newCollection);

		new Notice(
			`Renamed "${oldCollection}" to "${newCollection}"\n` +
				`Updated ${updatedFiles} files` +
				(errors > 0 ? `\nErrors in ${errors} files` : '') +
				(canvasUpdated ? '\nCanvas updated' : '\nFailed to update canvas')
		);
	}

	private async updateCanvasForRename(oldCollection: string, newCollection: string): Promise<boolean> {
		try {
			const canvasFile = resolveCanvasPath(this.app, this.settings);
			if (!canvasFile || !(canvasFile instanceof TFile)) return false;

			const content = await this.app.vault.read(canvasFile);
			const canvasData = parseCanvasContent(content);

			const cardIndex = canvasData.nodes.findIndex(
				(node: any) => node.text && node.text.includes(`label: ${oldCollection}\n`)
			);

			if (cardIndex !== -1) {
				const oldText = canvasData.nodes[cardIndex].text;
				const blockIdMatch = oldText.match(/Block ([0-9]{6})/);
				const blockId = blockIdMatch ? blockIdMatch[1] : null;

				if (!blockId) {
					console.error('Could not find block ID in card');
					return false;
				}

				const files = getExistingCardFiles(oldText);
				const searchTerms = parseCollectionValue(newCollection, this.settings.parseSpacesAsTerms);
				const encodedSearchTerms = searchTerms.join('%7C');
				const encodedFiles = files.map(f => encodeURIComponent(f)).join('%7C');

				const newSearchLink1 = `obsidian://search?&query=file%3A%20%2F%5E(${encodedFiles})%5C.md%2F%20%2F(${encodedSearchTerms})%2F`;
				const newSearchLink2 = `obsidian://search?query=file%3A%20%2F%5E(${encodedFiles})%5C.md%2F%20block%3A%20${blockId}`;
				const wikilinks = files.map(f => `- [[${f}#^${blockId}]]`).join('\n');

				const newText = [
					'```meta-bind-button',
					'style: primary',
					`label: ${newCollection}`,
					`id: ${Date.now().toString(36)}`,
					'action:',
					'  type: open',
					`  link: ${newSearchLink1}`,
					'```',
					'```meta-bind-button',
					'style: default',
					`label: Block ${blockId}`,
					`id: ${Date.now().toString(36)}`,
					'action:',
					'  type: open',
					`  link: ${newSearchLink2}`,
					'```',
					wikilinks
				].join('\n');

				canvasData.nodes[cardIndex].text = newText;
				await this.app.vault.modify(canvasFile, JSON.stringify(canvasData, null, 2));
				return true;
			}

			return false;
		} catch (error) {
			console.error('Error updating canvas for rename:', error);
			return false;
		}
	}

	onClose() {
		this.cleanupFunctions.forEach(cleanup => cleanup());
		this.cleanupFunctions = [];
		this.contentEl.empty();
		this.isRenameMode = false;
		this.originalCollection = '';
	}
}

const updateFileCollection = async (app: App, file: TFile, newCollectionValue: string, blockIdDate: string): Promise<boolean> => {
	try {
		await app.fileManager.processFrontMatter(file, frontmatter => {
			if (!frontmatter.collection) frontmatter.collection = [];
			if (!Array.isArray(frontmatter.collection)) {
				if (typeof frontmatter.collection === 'string') frontmatter.collection = [frontmatter.collection];
				else frontmatter.collection = [];
			}

			if (!frontmatter.collection.includes(newCollectionValue)) frontmatter.collection.push(newCollectionValue);
			return frontmatter;
		});

		const content = await app.vault.read(file);
		const blockId = `^${blockIdDate}`;
		if (!content.includes(blockId)) {
			let newContent = content;
			if (!content.endsWith('\n')) newContent += '\n';
			newContent += `${blockId}\n`;
			await app.vault.modify(file, newContent);
		}

		return true;
	} catch (error) {
		console.error(`Error updating collection for ${file.path}:`, error);
		return false;
	}
};

function getMostRecentBlockIdDate(app: App, files: TFile[]): string {
	const yymmddRegex = /^[0-9]{6}$/;
	let bestDate = '';

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.blocks) continue;
		for (const blockId of Object.keys(cache.blocks)) {
			if (yymmddRegex.test(blockId) && blockId > bestDate) {
				bestDate = blockId;
			}
		}
	}

	if (!bestDate) {
		const now = new Date();
		return (
			now.getFullYear().toString().slice(-2) +
			String(now.getMonth() + 1).padStart(2, '0') +
			String(now.getDate()).padStart(2, '0')
		);
	}

	return bestDate;
}

function buildBlockIdIndex(app: App, files: TFile[]): Map<string, TFile[]> {
	const yymmddRegex = /^[0-9]{6}$/;
	const index = new Map<string, TFile[]>();

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.blocks) continue;
		for (const blockId of Object.keys(cache.blocks)) {
			if (!yymmddRegex.test(blockId)) continue;
			if (!index.has(blockId)) index.set(blockId, []);
			index.get(blockId)!.push(file);
		}
	}

	return index;
}

function extractBlockIdFromSelection(selectedText: string): string | null {
	const match = selectedText.match(/(?:\^)?([0-9]{6})/);
	return match ? match[1] : null;
}

async function handleSelectionBasedCollection(
	app: App,
	settings: BlockCollectionsSettings,
	editor: Editor,
	file: TFile
): Promise<void> {
	const selectedText = editor.getSelection();
	if (!selectedText) {
		new Notice('No text selected');
		return;
	}

	const blockId = extractBlockIdFromSelection(selectedText);
	if (!blockId) {
		new Notice('No ^YYMMDD block ID found in selection');
		return;
	}

	const collectionValue = await findCollectionValueByBlockId(app, settings, blockId);
	if (!collectionValue) {
		new Notice(`No collection found for block ID: ${blockId}`);
		return;
	}

	const collectionModal = new CollectionInputModal(app, collectionValue, async result => {
		const newCollectionValue = result.trim();
		const success = await updateFileCollection(app, file, newCollectionValue, blockId);
		const canvasUpdated = await updateCanvasFile(app, settings, [file.basename], newCollectionValue, blockId);
		new Notice(
			`Updated ${file.basename}` +
				(success ? '' : '\nError updating frontmatter') +
				(canvasUpdated ? '\nCanvas created/updated' : '\nFailed to update canvas')
		);
	}, settings);

	collectionModal.open();
}

async function processFilesWithBlockId(
	app: App,
	settings: BlockCollectionsSettings,
	blockIdIndex: Map<string, TFile[]>,
	newCollectionValue: string,
	blockIdDate: string
) {
	const matchingFiles = blockIdIndex.get(blockIdDate) ?? [];

	if (matchingFiles.length === 0) {
		new Notice(`No files found with block ID: ^${blockIdDate}`);
		return;
	}

	let successCount = 0;
	let errorCount = 0;
	const processedFiles: string[] = [];

	for (const file of matchingFiles) {
		try {
			const success = await updateFileCollection(app, file, newCollectionValue, blockIdDate);
			if (success) {
				successCount++;
				processedFiles.push(file.basename);
			} else {
				errorCount++;
			}
		} catch (error) {
			console.error(`Error processing ${file.path}:`, error);
			errorCount++;
		}
	}

	const canvasUpdated = await updateCanvasFile(app, settings, processedFiles, newCollectionValue, blockIdDate);
	new Notice(
		`Updated ${successCount} files` +
			(errorCount > 0 ? `\nErrors in ${errorCount} files` : '') +
			(canvasUpdated ? '\nCanvas created/updated' : '\nFailed to update canvas')
	);
}

const addorremoveCollection = async (app: App, settings: BlockCollectionsSettings): Promise<void> => {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView) {
		const editor = activeView.editor;
		const selection = editor.getSelection();
		if (selection && selection.trim().length > 0) {
			if (activeView.file) return handleSelectionBasedCollection(app, settings, editor, activeView.file);
			new Notice('No active file to add to collection.');
			return;
		}
	}

	const files = app.vault.getMarkdownFiles().filter(file => {
		const parentFolder = file.parent?.name;
		return !parentFolder || !settings.foldersToExclude.includes(parentFolder);
	});

	if (files.length === 0) {
		new Notice('No eligible markdown files found in vault.');
		return;
	}

	const blockIdIndex = buildBlockIdIndex(app, files);
	const defaultDate = getMostRecentBlockIdDate(app, files);

	const collectionModal = new CollectionInputModal(app, '', async result => {
		const newCollectionValue = result.trim();

		const canvasFile = resolveCanvasPath(app, settings);
		if (!canvasFile) {
			new Notice('Canvas file not found');
			return;
		}

		const content = await app.vault.read(canvasFile);
		const canvasData = parseCanvasContent(content);
		const existingCardIndex = findExistingCard(canvasData, newCollectionValue);

		if (existingCardIndex !== -1) {
			const cardText = canvasData.nodes[existingCardIndex].text;
			const blockIdMatch = cardText.match(/Block ([0-9]{6})/);
			if (blockIdMatch) {
				await processFilesWithBlockId(app, settings, blockIdIndex, newCollectionValue, blockIdMatch[1]);
			}
			return;
		}
		setTimeout(() => {
			const dateModal = new DatePickerModal(app, defaultDate, async blockIdDate => {
				await processFilesWithBlockId(app, settings, blockIdIndex, newCollectionValue, blockIdDate);
			});
			dateModal.open();
		}, 0);
	}, settings);

	collectionModal.open();
};

class DatePickerModal extends Modal {
	onSubmit: (date: string) => void;
	defaultDate: string;
	private cleanupFunctions: (() => void)[] = [];

	constructor(app: App, defaultDate: string, onSubmit: (date: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.defaultDate = defaultDate;
	}

	onOpen() {
		this.contentEl.createEl('h2', { text: 'Choose BlockID Date (YYMMDD)' });
		const input = this.contentEl.createEl('input', { type: 'date' });
		const yyyy = '20' + this.defaultDate.slice(0, 2);
		const mm = this.defaultDate.slice(2, 4);
		const dd = this.defaultDate.slice(4, 6);
		input.value = `${yyyy}-${mm}-${dd}`;
		input.style.fontSize = '1.2em';
		input.style.margin = '1em 0';
		input.style.display = 'block';
		input.style.width = '100%';
		input.focus();

		const button = this.contentEl.createEl('button', { text: 'OK' });
		button.classList.add('mod-cta');
		button.onclick = () => {
			if (!input.value) {
			new Notice('Please select a date');
			return;
		}
			const [year, month, day] = input.value.split('-');
			const yymmdd = year.slice(-2) + month + day;
			new Notice('Picked date: ' + yymmdd);
			this.onSubmit(yymmdd);
			super.close();
		};

		const keydownHandler = (e: KeyboardEvent) => {
			if (e.key === 'Enter') button.click();
			if (e.key === 'Escape') super.close();
		};
		input.addEventListener('keydown', keydownHandler);
		this.cleanupFunctions.push(() => input.removeEventListener('keydown', keydownHandler));
	}

	onClose() {
		this.cleanupFunctions.forEach(cleanup => cleanup());
		this.cleanupFunctions = [];
		this.contentEl.empty();
	}
}

const blockIdCreator = async (app: App, settings: BlockCollectionsSettings): Promise<void> => {
	const activeLeaf = app.workspace.activeLeaf;
	let editor = (activeLeaf?.view as any)?.editor as Editor | undefined;
	let currentFile = app.workspace.getActiveFile();
	if (!editor || !currentFile) return;

	if (isHoverEditor(activeLeaf)) {
		const result = await handleHoverEditor(app, currentFile, editor);
		if (!result) return;
		editor = result.newEditor;
		currentFile = app.workspace.getActiveFile();
		if (!currentFile) return;
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	let selection = editor.getSelection();
	const hasSelection = selection.length > 0;

	const footnoteRegex = /\[\^[0-9]{1,3}\]/;
	if (footnoteRegex.test(selection)) {
		new Notice('Warning: Selection contains a footnote reference. Adding block ID but note that this line should not be embedded.');
	} else if (!hasSelection) {
		// Also check cursor line when there's no selection
		const cursor = editor.getCursor();
		const lineContent = editor.getLine(cursor.line);
		if (footnoteRegex.test(lineContent)) {
			new Notice('Warning: Current line contains a footnote reference. Adding block ID but note that this line should not be embedded.');
		}
	}

	if (hasSelection) {
		let match = selection.match(/^\^([a-zA-Z0-9-]+)$/);
		if (!match && selection.startsWith('^') && !/\[.*\^.*\]/.test(selection)) {
			match = selection.match(/^\^([a-zA-Z0-9-]+)/);
		}

		if (match && match[1]) {
			const blockId = match[1];
			await new Promise<void>(resolve => {
				const modal = new BlockIdCopyChoiceModal(app, currentFile, blockId, async type => {
					if (type === 'wikilink') {
						const clipboardText = `![[${currentFile.basename}#^${blockId}]]`;
						await navigator.clipboard.writeText(clipboardText);
						new Notice(`Link ${clipboardText} has been added to the clipboard`);
					} else {
						const vaultName = app.vault.getName();
						let filePath = currentFile.path;
						if (filePath.endsWith('.md')) filePath = filePath.slice(0, -3);
						const uri = `[${currentFile.basename}](obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}%23%5E${blockId})`;
						await navigator.clipboard.writeText(uri);
						new Notice('URL copied to your clipboard.');
					}
					resolve();
				});
				modal.open();
			});
			return;
		}

		// THe following was not good for iOS15
		// const inlineBlockIdRegex = /[^\[]\^([a-zA-Z0-9-]+)(?!\])/g;
		// const allBlockIds = Array.from(selection.matchAll(inlineBlockIdRegex), m => m[1]);
		const inlineBlockIdRegex = /[^\[]\^([a-zA-Z0-9-]+)/g;
		const allBlockIdMatches = Array.from(selection.matchAll(inlineBlockIdRegex));
		// Filter out block IDs followed by ] (iOS 15 compatible - no negative lookahead)
		const allBlockIds = allBlockIdMatches
			.filter(m => {
				const endPos = m.index! + m[0].length;
				return selection.charAt(endPos) !== ']';
			})
			.map(m => m[1]);
		if (allBlockIds.length === 1) {
			const blockId = allBlockIds[0];
			await new Promise<void>(resolve => {
				const modal = new BlockIdCopyChoiceModal(app, currentFile, blockId, async type => {
					if (type === 'wikilink') {
						const clipboardText = `![[${currentFile.basename}#^${blockId}]]`;
						await navigator.clipboard.writeText(clipboardText);
						new Notice(`Link ${clipboardText} has been added to the clipboard`);
					} else {
						const vaultName = app.vault.getName();
						let filePath = currentFile.path;
						if (filePath.endsWith('.md')) filePath = filePath.slice(0, -3);
						const uri = `[${currentFile.basename}](obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}%23%5E${blockId})`;
						await navigator.clipboard.writeText(uri);
						new Notice('URL copied to your clipboard.');
					}
					resolve();
				});
				modal.open();
			});
			return;
		}

		if (allBlockIds.length > 1) {
			new Notice('Multiple block IDs found in selection. Please select only one block ID.');
			return;
		}
	}

	const headingRegex = /^(#{1,6})\s+(.+)$/;
	const headingMatch = selection.trim().match(headingRegex);
	if (headingMatch) {
		const headingText = headingMatch[2].trim();
		const clipboardText = `[[${currentFile.basename}#${headingText}]]`;
		await navigator.clipboard.writeText(clipboardText);
		new Notice(`Heading link ${clipboardText} has been added to the clipboard`);
		return;
	}

	const selStart = editor.getCursor('from');
	const selEnd = editor.getCursor('to');

	// Use editor content directly as source of truth to avoid disk round-trip issues
	const editorContent = editor.getValue();
	const lines = editorContent.split('\n');
	let charStart = 0,
		charEnd = 0;
	for (let i = 0; i < selStart.line; i++) charStart += lines[i].length + 1;
	charStart += selStart.ch;
	for (let i = 0; i < selEnd.line; i++) charEnd += lines[i].length + 1;
	charEnd += selEnd.ch;

	// Check if editor content matches selection
	const editorContentAtSelection = editorContent.substring(charStart, charEnd);
	let fileContent: string;
	if (editorContentAtSelection === selection) {
		// Editor content is consistent with selection — use it as working copy
		fileContent = editorContent;
	} else {
		// Still out of sync somehow — fall back to disk content as-is
		console.log('[BlockCollections] Editor content mismatch, falling back to disk...');
		fileContent = await app.vault.read(currentFile);
		const diskLines = fileContent.split('\n');
		charStart = 0;
		charEnd = 0;
		for (let i = 0; i < selStart.line; i++) charStart += diskLines[i].length + 1;
		charStart += selStart.ch;
		for (let i = 0; i < selEnd.line; i++) charEnd += diskLines[i].length + 1;
		charEnd += selEnd.ch;
	}

	const textAfterSelection = fileContent.substring(charEnd);
	const nextLineBlockIdMatch = textAfterSelection.match(/^\s*\n\^([a-zA-Z0-9-]+)/);
	const inlineBlockIdMatch = textAfterSelection.match(/^\s\^([a-zA-Z0-9-]+)/);
	if (nextLineBlockIdMatch || inlineBlockIdMatch) {
		const existingBlockId = (nextLineBlockIdMatch || inlineBlockIdMatch)?.[1];
		if (!existingBlockId) return;
		const authorTitle = findFirstH4Heading(fileContent, selection);
		await updateZoteroFrontmatter(app, settings, currentFile, selection, authorTitle);
		const clipboardText = `![[${currentFile.basename}#^${existingBlockId}]]`;
		await navigator.clipboard.writeText(clipboardText);
		new Notice(`Link ${clipboardText} has been added to the clipboard`);
		return;
	}

	const zoteroRegex = /items\/([A-Z0-9]{6,10}).*?annotation=([A-Z0-9]{6,10})/g;
	const blockIdInlineRegex = /[^\[]\^([a-zA-Z0-9-]+)(?:\s|$)/;
	const selectionInlineBlockId = selection.match(blockIdInlineRegex);
	if (selectionInlineBlockId) {
		const clipboardText = `![[${currentFile.basename}#^${selectionInlineBlockId[1]}]]`;
		await navigator.clipboard.writeText(clipboardText);
		new Notice(`Link ${clipboardText} has been added to the clipboard`);
		return;
	}

	const allMatches = [...selection.matchAll(zoteroRegex)];
	if (allMatches.length > 0) {
		const createdBlockIds: string[] = [];
		const authorTitle = findFirstH4Heading(fileContent, selection);
		const paragraphs = selection.split(/\n{2,}/);

		const pendingFrontmatterChanges: {
			[key: string]: string[] | undefined;
		} = {};

		const updatedParagraphs = paragraphs.map(paragraph => {
			const existingBlockId = paragraph.match(blockIdInlineRegex);
			if (existingBlockId) {
				createdBlockIds.push(existingBlockId[1]);
				return paragraph;
			}

			const paragraphMatches = [...paragraph.matchAll(zoteroRegex)];
			if (paragraphMatches.length === 0) return paragraph;

			const lastMatch = paragraphMatches[paragraphMatches.length - 1];
			const combinedId = `${lastMatch[1]}-${lastMatch[2]}`;
			createdBlockIds.push(combinedId);

			if (authorTitle) {
				const authorKey = settings.zoteroAuthorTitleKey;
				const itemIdKey = settings.zoteroItemIdKey;
				pendingFrontmatterChanges[authorKey] ||= [];
				pendingFrontmatterChanges[itemIdKey] ||= [];

				if (!pendingFrontmatterChanges[authorKey]!.includes(authorTitle)) {
					pendingFrontmatterChanges[authorKey]!.push(authorTitle);
				}

				paragraphMatches.forEach(m => {
					if (!pendingFrontmatterChanges[itemIdKey]!.includes(m[1])) pendingFrontmatterChanges[itemIdKey]!.push(m[1]);
				});
			}

			return `${paragraph.trim()} ^${combinedId}`;
		});

		const newContent = ensureProperLineSpacing(fileContent, charStart, charEnd, updatedParagraphs.join('\n\n'));
		await app.vault.modify(currentFile, newContent);
		await new Promise(resolve => setTimeout(resolve, 2000));

		if (Object.keys(pendingFrontmatterChanges).length > 0) {
			await app.fileManager.processFrontMatter(currentFile, frontmatter => {
				const authorKey = settings.zoteroAuthorTitleKey;
				const itemIdKey = settings.zoteroItemIdKey;
				if (pendingFrontmatterChanges[authorKey]?.length) {
					frontmatter[authorKey] ||= [];
					pendingFrontmatterChanges[authorKey]!.forEach(title => {
						if (!frontmatter[authorKey].includes(title)) frontmatter[authorKey].push(title);
					});
				}

				if (pendingFrontmatterChanges[itemIdKey]?.length) {
					frontmatter[itemIdKey] ||= [];
					pendingFrontmatterChanges[itemIdKey]!.forEach(id => {
						if (!frontmatter[itemIdKey].includes(id)) frontmatter[itemIdKey].push(id);
					});
				}

				frontmatter.date_modified = moment().format('YYYY-MM-DDTHH:mm');
				return frontmatter;
			});
		}

		if (createdBlockIds.length === 1 && !currentFile.basename.startsWith('@')) {
			const clipboardText = `![[${currentFile.basename}#^${createdBlockIds[0]}]]`;
			await navigator.clipboard.writeText(clipboardText);
			new Notice(`Link ${clipboardText} has been added to the clipboard`);
		} else if (createdBlockIds.length > 1) {
			new Notice('Multiple block IDs created. No link added to the clipboard.');
		}

		return;
	}

	selection = selection.replace(/\s+$/, '');
	const endsWithBlockquoteLine = (text: string): boolean => {
		const normalized = text.replace(/\n+$/, '');
		const ls = normalized.split('\n');
		const lastLine = ls[ls.length - 1] ?? '';
		return /^>/.test(lastLine.trimStart());
	};

	await new Promise<void>(resolve => {
		const modal = new BlockIdChoiceModal(app, async type => {
			if (type === 'random') {
				const blockId = generateRandomBlockId().trim();

				if (hasSelection) {
					const isBlockquote = endsWithBlockquoteLine(selection);
					const newBlock = isBlockquote
						? selection.replace(/\n+$/, '').replace(/\s+$/, '') + ` ^${blockId}`
						: selection + `\n^${blockId}`;

					const newContent = ensureProperLineSpacing(fileContent, charStart, charEnd, newBlock);
					await app.vault.modify(currentFile, newContent);
					const clipboardText = `![[${currentFile.basename}#^${blockId}]]`;
					await navigator.clipboard.writeText(clipboardText);
					new Notice(`Link ${clipboardText} has been added to the clipboard`);
					resolve();
					return;
				}

				const cursor = editor.getCursor();
				const lineNumber = cursor.line;
				const lineContent = editor.getLine(lineNumber);

				let charLineStart = 0;
				const fileLines = fileContent.split('\n');
				for (let i = 0; i < lineNumber; i++) charLineStart += fileLines[i].length + 1;
				const blockStart = charLineStart;
				const blockEnd = charLineStart + lineContent.length;
				const trimmedLine = lineContent.replace(/\s+$/, '');
				const newBlock = trimmedLine + (trimmedLine ? ' ' : '') + `^${blockId}`;
				const newContent = ensureProperLineSpacing(fileContent, blockStart, blockEnd, newBlock);
				await app.vault.modify(currentFile, newContent);

				const clipboardText = `![[${currentFile.basename}#^${blockId}]]`;
				await navigator.clipboard.writeText(clipboardText);
				new Notice(`Link ${clipboardText} has been added to the clipboard`);
				resolve();
				return;
			}

			const now = new Date();
			const year = now.getFullYear().toString().slice(-2);
			const month = (now.getMonth() + 1).toString().padStart(2, '0');
			const day = now.getDate().toString().padStart(2, '0');
			const defaultDate = `${year}${month}${day}`;
			const dateModal = new EnhancedDatePickerModal(
				app,
				defaultDate,
				async pickedDate => {
					const blockId = pickedDate.trim();
					if (hasSelection) {
						const isBlockquote = endsWithBlockquoteLine(selection);
						const newBlock = isBlockquote
							? selection.replace(/\n+$/, '').replace(/\s+$/, '') + ` ^${blockId}`
							: selection + `\n^${blockId}`;

						const newContent = ensureProperLineSpacing(fileContent, charStart, charEnd, newBlock);
						await app.vault.modify(currentFile, newContent);
						const clipboardText = `![[${currentFile.basename}#^${blockId}]]`;
						await navigator.clipboard.writeText(clipboardText);
						new Notice(`Link ${clipboardText} has been added to the clipboard`);
						resolve();
						return;
					}

					const cursor = editor.getCursor();
					const lineNumber = cursor.line;
					const lineContent = editor.getLine(lineNumber);

					let charLineStart = 0;
					const fileLines = fileContent.split('\n');
					for (let i = 0; i < lineNumber; i++) charLineStart += fileLines[i].length + 1;
					const blockStart = charLineStart;
					const blockEnd = charLineStart + lineContent.length;

					const trimmedLine = lineContent.replace(/\s+$/, '');
					const newBlock = trimmedLine + (trimmedLine ? ' ' : '') + `^${blockId}`;
					const newContent = ensureProperLineSpacing(fileContent, blockStart, blockEnd, newBlock);
					await app.vault.modify(currentFile, newContent);

					const clipboardText = `![[${currentFile.basename}#^${blockId}]]`;
					await navigator.clipboard.writeText(clipboardText);
					new Notice(`Link ${clipboardText} has been added to the clipboard`);
					resolve();
				},
				() => settings.canvasRelativePath,
				'search',
				settings
			);
			dateModal.open();
		});

		modal.open();
	});
};

const collectionQuerier = async (app: App, settings: BlockCollectionsSettings): Promise<void> => {
	await new Promise<void>(resolve => {
		const modal = new CollectionQueryInputModal(
			app,
			settings,
			async userInput => {
				const safeInput = userInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				
				// Get the specific block ID for this collection from canvas
				const blockId = await getBlockIdForCollection(app, settings, userInput);
				
				let query: string;
			if (blockId) {
				query =
					`(["collection": /${safeInput}/] /\\^${blockId}/) ` +
					`OR (["collection": /${safeInput}/] - /\\^${blockId}/)`;
			} else {
				query =
					`(["collection": /${safeInput}/] /(^|[^0-9])\\^[0-9]{6}/) ` +
					`OR (["collection": /${safeInput}/] - /(^|[^0-9])\\^[0-9]{6}/)`;

				new Notice('Block ID not found for this collection, using generic query');
			}
							
				const encodedQuery = encodeURIComponent(query);
				const uri = `obsidian://search?query=${encodedQuery}`;
				const link = document.createElement('a');
				link.href = uri;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				navigator.clipboard
					.writeText(query)
					.then(() => new Notice('Query copied to clipboard and search opened.'))
					.catch(() => new Notice('Search opened.'));
				resolve();
			},
			async userInput => {
				const safeInput = userInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				
				// Get the specific block ID for this collection from canvas
				const blockId = await getBlockIdForCollection(app, settings, userInput);
				
				const key = settings.plantUMLFrontmatterKey;
				let query: string;
				
				if (blockId) {
					// Use specific block ID for precise matching
					query = `(((["${key}": /${safeInput}/] /\\^${blockId}/) OR (["${key}": /${safeInput}/] - /\\^${blockId}/) OR (["${key}": /${safeInput}/] /\`\`\`plantuml/)) OR ((["collection": /${safeInput}/] /\\^${blockId}/) OR (["collection": /${safeInput}/] - /\\^${blockId}/)))`;
				} else {
					// Fallback to generic regex
					query = `(((["${key}": /${safeInput}/] /(^|[^0-9])\\^[0-9]{6}/) OR (["${key}": /${safeInput}/] - /(^|[^0-9])\\^[0-9]{6}/) OR (["${key}": /${safeInput}/] /\`\`\`plantuml/)) OR ((["collection": /${safeInput}/] /(^|[^0-9])\\^[0-9]{6}/) OR (["collection": /${safeInput}/] - /(^|[^0-9])\\^[0-9]{6}/)))`;
				}
				
				const encodedQuery = encodeURIComponent(query);
				const uri = `obsidian://search?query=${encodedQuery}`;
				const link = document.createElement('a');
				link.href = uri;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				navigator.clipboard
					.writeText(query)
					.then(() => new Notice('Query copied to clipboard and search opened.'))
					.catch(() => new Notice('Search opened.'));
				resolve();
			}
		);

		modal.open();
	});
};

class BlockCollectionsSettingTab extends PluginSettingTab {
	plugin: BlockCollectionsPlugin;

	constructor(app: App, plugin: BlockCollectionsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Canvas relative path')
			.setDesc('Path to the collections canvas file, relative to vault root.')
			.addText(text =>
				text.setValue(this.plugin.settings.canvasRelativePath).onChange(async value => {
					this.plugin.settings.canvasRelativePath = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Folders to exclude')
			.setDesc('Comma-separated folder names to skip when scanning markdown files.')
			.addTextArea(text => {
				text.setValue(this.plugin.settings.foldersToExclude.join(', '));
				text.onChange(async value => {
					this.plugin.settings.foldersToExclude = value
						.split(',')
						.map(v => v.trim())
						.filter(Boolean);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Parse spaces as separate search terms')
			.setDesc('When enabled, "obsidian blocks" becomes obsidian|blocks in canvas search queries, same as writing "obsidian, blocks".')
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.parseSpacesAsTerms).onChange(async value => {
					this.plugin.settings.parseSpacesAsTerms = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Show PlantUML')
			.setDesc('Show PlantUML section in Collection Querier.')
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.showPlantUML).onChange(async value => {
					this.plugin.settings.showPlantUML = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('PlantUML frontmatter key')
			.setDesc('Frontmatter property name that stores PlantUML nodes.')
			.addText(text =>
				text.setValue(this.plugin.settings.plantUMLFrontmatterKey).onChange(async value => {
					this.plugin.settings.plantUMLFrontmatterKey = value.trim() || DEFAULT_SETTINGS.plantUMLFrontmatterKey;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Zotero author-title frontmatter key')
			.setDesc('Frontmatter property name that stores Zotero author/title references.')
			.addText(text =>
				text.setValue(this.plugin.settings.zoteroAuthorTitleKey).onChange(async value => {
					this.plugin.settings.zoteroAuthorTitleKey = value.trim() || DEFAULT_SETTINGS.zoteroAuthorTitleKey;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Zotero item ID frontmatter key')
			.setDesc('Frontmatter property name that stores Zotero item IDs.')
			.addText(text =>
				text.setValue(this.plugin.settings.zoteroItemIdKey).onChange(async value => {
					this.plugin.settings.zoteroItemIdKey = value.trim() || DEFAULT_SETTINGS.zoteroItemIdKey;
					await this.plugin.saveSettings();
				})
			);
	}
}

export default class BlockCollectionsPlugin extends Plugin {
	settings: BlockCollectionsSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'block-id-creator-and-link-copier',
			name: 'Block ID Creator and Link Copier',
			callback: () => blockIdCreator(this.app, this.settings)
		});

		this.addCommand({
			id: 'add-to-or-remove-from-collection',
			name: 'Add to or Remove from Collection',
			callback: () => addorremoveCollection(this.app, this.settings)
		});

		this.addCommand({
			id: 'collection-querier',
			name: 'Collection Querier',
			callback: () => collectionQuerier(this.app, this.settings)
		});

		this.addSettingTab(new BlockCollectionsSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
