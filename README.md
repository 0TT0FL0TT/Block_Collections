# Block Collections Plugin — Usage Guide

## Overview

The plugin provides three commands and a settings tab. Everything revolves around a central **Collections Canvas** file — an Obsidian canvas you create and whose path you configure in settings. Canvas cards on that file act as the registry: each card represents one collection, stores its collection block ID, lists the files belonging to it and offers buttons so you don't need to manually type in queries in the Obsidian Core Search plugin.  

---

## Settings

Open Settings → Block Collections to configure:

- **Canvas relative path** — path to your canvas file from the vault root (default: `Canvases/Collections.canvas`)
- **Folders to exclude** — comma-separated folder names skipped during vault-wide scans (default: `SYSTEM`, `DAILY`, `assets`, `HUB`)
- **Show PlantUML** — toggles the PlantUML section in the Collection Querier modal (default: `false`, because scripts relating to the handling of frontmatter properties to files are not bundled with the plugin)

Other settings that only make sense to the author of this plugin:
- **PlantUML frontmatter key** — the frontmatter property used for PlantUML node values (default: `plantuml_nodes`)
- **Zotero author-title frontmatter key** — property written when block IDs are created from Zotero annotation links (default: `zotero_author-title`)
- **Zotero item ID frontmatter key** — property written for Zotero item IDs (default: `zotero_itemid`)

---

## Command 1: Block ID Creator and Link Copier

This command adds block IDs to text and copies embeddable links to the clipboard. It has several distinct behaviours depending on what is selected.

### Hover Editor handling

If the command is triggered from a Hover Editor popup, the plugin automatically closes the hover editor, opens the file in a new tab, restores your cursor position or selection, and continues as normal.

### When the selection is already a block ID (`^xxxxxx`)

If you select just a block ID — either bare (`^abc123`) or as part of a line that contains one — a modal appears asking whether to copy it as:

- **Wikilink**: `![[Filename#^abc123]]` — for embedding
- **Obsidian URI**: `[Filename](obsidian://open?vault=...&file=...%23%5Eabc123)` — for cross-app linking

### When the selection is a Markdown heading

If you select a heading line (any level, `#` through `######`), the plugin copies a heading link to the clipboard: `[[Filename#Heading Text]]`. No block ID is created.

### When the selection or cursor line already has a block ID attached

If the text just after your selection already has a block ID (either inline or on the next line), the plugin reuses that existing ID rather than creating a new one. If the content contains Zotero annotation links, it also updates the frontmatter (see Zotero section below). The link is copied to the clipboard.

### When the selection contains Zotero annotation links

Zotero annotation links follow the pattern `items/ITEMID/...annotation=ANNOTID`. When detected **and** there is an H4 heading (`#### ...`) above your selection, the plugin:

1. Splits the selection into paragraphs
2. For each paragraph containing a Zotero link, creates a block ID in the format `^ITEMID-ANNOTID` using the last Zotero match in that paragraph
3. Appends the block ID inline to the paragraph
4. Updates the frontmatter with:
   - `zotero_itemid` — all unique Zotero item IDs found in the selection (array)
   - `zotero_author-title` — the text of the nearest H4 heading above the selection
   - `date_modified` — current timestamp

**Important:** Frontmatter updates only occur when **both** conditions are met: Zotero links present AND an H4 heading exists above the selection. If there's no H4 heading, block IDs are still created but frontmatter is not modified.

**Note:** This Zotero integration is currently tailored to the author's specific workflow and may not benefit general users without similar Zotero-PDF annotation setups.

### When the selection is regular text (no Zotero links, no existing block ID)

A modal appears asking which type of block ID to generate:

**General Purpose (Random)** — generates a 6-character random alphanumeric ID (e.g. `^k3mz9r`). The ID is appended to the selection or the current cursor line, and the embed link is copied to the clipboard.

**Collections (YYMMDD)** — opens the Enhanced Date Picker modal. On the bottom, there is a search view where you can search by collection name, filename, or block ID across your canvas. Results show the collection name, its block ID, and the files belonging to it.

- Clicking a result's top section uses that collection's block ID.
- Clicking a file link in the bottom section opens that file and scrolls to the block ID line. Ctrl/Cmd+click opens in a new tab.

There is a **Create New** toggle button. When clicked, it hides the search view and shows a date picker pre-filled with today's date. Click it again to return to search. The **Use This Date** button confirms the date and uses it as the block ID.

For blockquote lines, the block ID is appended inline at the end of the last line rather than on a new line. At end-of-file, block IDs are always converted to inline format (never placed on a new line below the block). The plugin also handles end-of-file spacing so no trailing blank lines are created incorrectly.

A footnote warning is briefly shown if the selection or the current cursor line contains footnote references (`[^1]`), since embedded blocks with footnotes will not render correctly when the block is embedded in another file.

---

## Command 2: Add to or Remove from Collection

This command manages which files belong to which collection, and keeps the canvas in sync.

### No Selection — Vault-Wide Mode

Trigger the command with no text selected. The plugin scans the entire vault for markdown files, excluding folders listed in settings, then opens the Collection Input Modal.
- Make it less taxing on Obsidian, add as many folders as you want to exclude from the scan.

**If the collection blockID already exists on a card in the canvas:** The plugin reads the block ID from that canvas card, then scans the vault for all files containing that block ID. Only those matching files get the collection added to their `collection` frontmatter property. The canvas card is rebuilt with the merged file list, preserving the card's position.

**If the collection does not exist yet:** A date picker appears. You confirm or change the date referring to your block ID created in the first phase, and only files containing that block ID get processed. A new canvas card is created at the next available position.

In both cases, files without the matching block ID are silently skipped. The vault-wide scan finds candidates — the block ID is the real filter.

### The Collection Input Modal

The modal has three sections:

**Top section — Add to collection:**
A text input accepts a new or existing collection name (comma-separated values supported). Below it is a filterable list of all existing collections. Clicking a list item immediately calls submit with that collection name — it does not just fill the input. This means a misclick has the same effect as an intentional submission: the workflow runs in full with no confirmation step and no undo. If you catch a misclick immediately, you need to manually remove the collection from the affected file's frontmatter and update the canvas card.

An **Add** button submits whatever is in the text field. A **Cancel** button closes without action.

**Rename Existing Collection section:**
A filterable list of all existing collections. Clicking one opens a prompt for the new name. The rename updates the collection value in every affected file's frontmatter and rebuilds the canvas card along with the links in the Meta Bind buttons under the new name.

**Remove File from Collection section:**
Open a markdown file with the block ID of the collection you want to remove the active file from.  
Shows only the collections that the currently active file belongs to. Each entry also shows the collection's canvas block ID (for example: `Remove file from: obsidian, git, workflow (Block 260407)`). Clicking one removes that collection from the active file's frontmatter, removes the file's wikilink from the canvas card, and rebuilds the card along with the Meta Bind button content. If no files remain in the collection, the canvas card is deleted entirely. The modal closes automatically. There is no confirmation step.

If the collection has an associated collection block ID, the plugin also removes that block ID from the file content.

### Canvas Cards

Each card created by this command contains two Meta Bind buttons and a wikilink list:

- **Collection title button** (primary style, top): opens an Obsidian search across the collection's files for content matching the collection's label terms. Use this to find notes whose body text relates to the collection topic.
- **Block `YYMMDD` button** (default style, below): opens a search for the specific block ID across the collection's files. Use this to jump directly to the dated block entries — the exact passages tagged when the collection was created. The button label is rendered as `Block 260407` (for example).
- Below the buttons: a list of wikilinks to each file, each pointing directly to the block ID anchor (`[[Filename#^YYMMDD]]`).

The file list inside a card is sorted alphabetically and missing files are pruned automatically when a card is rebuilt. Similar collection names trigger a notice after the collection is added so you can catch near-duplicates and reframe existing collections if necessary.

---

## Command 3: Collection Querier

Opens a modal for building and firing Obsidian search queries against your collections. The modal has two sections (the PlantUML section can be hidden via settings).

### PlantUML Nodes & Collection Query (top section, if enabled)

A filterable dropdown populated from all `collection` and `plantuml_nodes` frontmatter values across the vault. The filter supports regex — no slashes needed, just type the pattern. Clicking a value fills the input field. The **Search PlantUML + Collection** button fires a combined query that searches for the value across both `plantuml_nodes` and `collection` frontmatter. If the input matches a known collection with a block ID on canvas, the query uses that specific ID for precision; otherwise it falls back to a generic date-format block ID pattern.

If the filter returns multiple values, the notice advises narrowing to a single string for better results.

### Collection Query Only (bottom section)

A filterable dropdown of all `collection` frontmatter values. Clicking a value fills the input. The **Search Collection** button fires a query scoped only to the `collection` frontmatter, also with and without block ID variants. Same canvas lookup logic applies for precision.

Both buttons copy the generated query string to the clipboard and open it in Obsidian's built-in search simultaneously.

Escape closes the modal. Enter triggers the focused section's submit button.  