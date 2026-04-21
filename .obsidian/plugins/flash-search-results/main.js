const { Plugin } = require('obsidian');

const FLASH_CLASS = 'flash-search-results';
const PROCESSED_ATTR = 'data-blockid-checked';

module.exports = class FlashSearchResultsPlugin extends Plugin {

    async onload() {
        this.embedIndex = new Set();
        this.debounceTimer = null;
        this.observer = null;

        this.app.workspace.onLayoutReady(() => {
            this.buildEmbedIndex();
            this.startObserver();
        });

        this.registerEvent(
            this.app.metadataCache.on('changed', () => this.buildEmbedIndex())
        );
    }

    onunload() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        document.querySelectorAll(`.${FLASH_CLASS}`).forEach(el => el.classList.remove(FLASH_CLASS));
        document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => el.removeAttribute(PROCESSED_ATTR));
        document.querySelectorAll('[data-blockid-checked]').forEach(el => el.removeAttribute('data-blockid-checked'));
    }

    buildEmbedIndex() {
        const next = new Set();
        for (const f of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(f);
            if (!cache?.embeds) continue;
            for (const embed of cache.embeds) {
                const hashIdx = embed.link.indexOf('#');
                if (hashIdx === -1) continue;
                const subpath = embed.link.slice(hashIdx + 1);
                if (!subpath.startsWith('^')) continue;
                const linkpath = embed.link.slice(0, hashIdx);
                const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, f.path);
                if (!target) continue;
                next.add(`${target.path}#${subpath}`);
            }
        }
        this.embedIndex = next;
    }

    findBlockIdForLine(matchedLine, fileCache) {
        if (!fileCache?.blocks) return null;
        for (const [id, block] of Object.entries(fileCache.blocks)) {
            if (matchedLine >= block.position.start.line &&
                matchedLine <= block.position.end.line) {
                return `^${id}`;
            }
        }
        return null;
    }

    getFilePath(result) {
    // Try data-link-path first (present when certain plugins are active)
    const el = result.querySelector('[data-link-path]');
    if (el?.dataset?.linkPath) return el.dataset.linkPath;

    // Fallback: resolve display name from .tree-item-inner
    const titleEl = result.querySelector('.tree-item-inner');
    if (!titleEl) return null;
    const displayName = titleEl.textContent?.trim();
    if (!displayName) return null;

    // Find matching file in vault by basename
    const file = this.app.metadataCache.getFirstLinkpathDest(displayName, '');
    return file?.path ?? null;
}

    async processResults() {
        const results = document.querySelectorAll('.search-result');
        if (results.length === 0) return;

        for (const result of Array.from(results)) {
            if (result.dataset.blockidChecked) continue;

            const filePath = this.getFilePath(result);
            if (!filePath) continue;

            const matchEls = result.querySelectorAll('.search-result-file-matched-text');
            const unprocessed = Array.from(matchEls).filter(el => !el.hasAttribute(PROCESSED_ATTR));

            if (unprocessed.length === 0) {
                result.dataset.blockidChecked = '1';
                continue;
            }

            const file = this.app.vault.getFileByPath(filePath);
            if (!file) {
                unprocessed.forEach(el => el.setAttribute(PROCESSED_ATTR, '1'));
                result.dataset.blockidChecked = '1';
                continue;
            }

            const fileCache = this.app.metadataCache.getFileCache(file);
            if (!fileCache?.blocks) {
                unprocessed.forEach(el => el.setAttribute(PROCESSED_ATTR, '1'));
                result.dataset.blockidChecked = '1';
                continue;
            }

            const content = await this.app.vault.cachedRead(file);
            const lines = content.split('\n');

            for (const matchEl of unprocessed) {
                matchEl.setAttribute(PROCESSED_ATTR, '1');

                const snippet = matchEl.textContent?.trim().toLowerCase() ?? '';
                if (!snippet) continue;

                for (let i = 0; i < lines.length; i++) {
                    const stripped = lines[i]
                        .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
                        .replace(/`[^`]*`/g, ' ')
                        .replace(/%%.*?%%/g, ' ')
                        .replace(/\^[a-zA-Z0-9-]+\s*$/, '')
                        .replace(/[*_~]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

                    if (!stripped.includes(snippet) && !lines[i].toLowerCase().includes(snippet)) continue;

                    const blockId = this.findBlockIdForLine(i, fileCache);
                    if (blockId && this.embedIndex.has(`${filePath}#${blockId}`)) {
                        matchEl.classList.add(FLASH_CLASS);
                    }
                    break;
                }
            }

            result.dataset.blockidChecked = '1';
        }
    }

    scheduleProcess() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.processResults();
        }, 400);
    }

    startObserver() {
        const workspace = document.querySelector('.workspace');
        if (!workspace) return;

        this.observer = new MutationObserver(() => {
            const children = document.querySelector('.search-results-children');
            if (children && children.children.length > 0) this.scheduleProcess();
        });

        this.observer.observe(workspace, { childList: true, subtree: true });
    }
};
