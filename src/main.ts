import {
	App,
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	moment,
} from "obsidian";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReadingStatus = "want-to-read" | "reading" | "finished" | "abandoned";

interface BookData {
	title: string;
	author: string;
	genre: string;
	year: string;
	pages: string;
	status: ReadingStatus;
	rating: number;
	review: string;
	quotes: string;
	themes: string;
}

interface BookTrackerSettings {
	booksFolder: string;
	themesFolder: string;
	autoOpenBook: boolean;
}

const DEFAULT_SETTINGS: BookTrackerSettings = {
	booksFolder: "Books",
	themesFolder: "Books/Themes",
	autoOpenBook: true,
};

const STATUS_LABELS: Record<ReadingStatus, string> = {
	"want-to-read": "Want to Read",
	reading: "Reading",
	finished: "Finished",
	abandoned: "Abandoned",
};

const STATUS_EMOJI: Record<ReadingStatus, string> = {
	"want-to-read": "📚",
	reading: "📖",
	finished: "✅",
	abandoned: "❌",
};

// ─── Library View ─────────────────────────────────────────────────────────────

const LIBRARY_VIEW_TYPE = "book-tracker-library";

class LibraryView extends ItemView {
	plugin: BookTrackerPlugin;
	private filterStatus: ReadingStatus | "all" = "all";

	constructor(leaf: WorkspaceLeaf, plugin: BookTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return LIBRARY_VIEW_TYPE; }
	getDisplayText() { return "Book Library"; }
	getIcon() { return "book-open"; }

	async onOpen() { await this.render(); }

	async render() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("bt-library");

		const header = container.createEl("div", { cls: "bt-header" });
		header.createEl("h2", { text: "Library" });

		const addBtn = header.createEl("button", { text: "+ Add Book", cls: "bt-btn-primary" });
		addBtn.addEventListener("click", () => {
			this.plugin.openAddBookModal(() => this.render());
		});

		// Filter bar
		const filters = container.createEl("div", { cls: "bt-filters" });
		const allStatuses: Array<ReadingStatus | "all"> = ["all", "reading", "finished", "want-to-read", "abandoned"];
		for (const s of allStatuses) {
			const btn = filters.createEl("button", {
				text: s === "all" ? "All" : STATUS_LABELS[s],
				cls: `bt-filter-btn${this.filterStatus === s ? " active" : ""}`,
			});
			btn.addEventListener("click", () => {
				this.filterStatus = s;
				this.render();
			});
		}

		const books = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(this.plugin.settings.booksFolder + "/") &&
				!f.path.startsWith(this.plugin.settings.themesFolder + "/"));

		const filtered =
			this.filterStatus === "all"
				? books
				: books.filter((f) => {
						const cache = this.plugin.app.metadataCache.getFileCache(f);
						return cache?.frontmatter?.status === this.filterStatus;
				  });

		if (filtered.length === 0) {
			container.createEl("p", { text: "No books found. Add your first book!", cls: "bt-empty" });
			return;
		}

		container.createEl("p", { text: `${filtered.length} book${filtered.length !== 1 ? "s" : ""}`, cls: "bt-count" });

		const grid = container.createEl("div", { cls: "bt-grid" });

		for (const file of filtered.sort((a, b) => b.stat.mtime - a.stat.mtime)) {
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter ?? {};
			const status: ReadingStatus = fm.status ?? "want-to-read";
			const rating: number = fm.rating ?? 0;

			const card = grid.createEl("div", { cls: "bt-card" });

			const cardTop = card.createEl("div", { cls: "bt-card-top" });
			cardTop.createEl("span", { text: STATUS_EMOJI[status], cls: "bt-status-icon" });
			const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
			cardTop.createEl("span", { text: stars, cls: "bt-stars" });

			const title = card.createEl("div", { text: file.basename, cls: "bt-card-title" });
			title.addEventListener("click", () => {
				this.plugin.app.workspace.openLinkText(file.path, "", false);
			});

			if (fm.author) card.createEl("div", { text: fm.author, cls: "bt-card-author" });
			if (fm.genre) card.createEl("div", { text: fm.genre, cls: "bt-card-genre" });
		}
	}
}

// ─── Add Book Modal ───────────────────────────────────────────────────────────

class AddBookModal extends Modal {
	plugin: BookTrackerPlugin;
	onDone: () => void;

	constructor(app: App, plugin: BookTrackerPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("bt-modal");
		contentEl.createEl("h2", { text: "Add Book" });

		const data: BookData = {
			title: "", author: "", genre: "", year: "", pages: "",
			status: "want-to-read", rating: 0, review: "", quotes: "", themes: "",
		};

		new Setting(contentEl).setName("Title").addText((t) => {
			t.setPlaceholder("Book title").onChange((v) => (data.title = v));
			t.inputEl.focus();
		});
		new Setting(contentEl).setName("Author").addText((t) => t.setPlaceholder("Author name").onChange((v) => (data.author = v)));
		new Setting(contentEl).setName("Genre").addText((t) => t.setPlaceholder("e.g. Fiction, Biography").onChange((v) => (data.genre = v)));
		new Setting(contentEl).setName("Year published").addText((t) => t.setPlaceholder("e.g. 2021").onChange((v) => (data.year = v)));
		new Setting(contentEl).setName("Pages").addText((t) => t.setPlaceholder("e.g. 320").onChange((v) => (data.pages = v)));

		new Setting(contentEl).setName("Status").addDropdown((d) => {
			for (const [val, label] of Object.entries(STATUS_LABELS)) {
				d.addOption(val, label);
			}
			d.setValue("want-to-read").onChange((v) => (data.status = v as ReadingStatus));
		});

		new Setting(contentEl).setName("Rating (0–5)").addSlider((s) =>
			s.setLimits(0, 5, 1).setValue(0).setDynamicTooltip().onChange((v) => (data.rating = v))
		);

		new Setting(contentEl).setName("Review").addTextArea((a) => {
			a.setPlaceholder("Your thoughts...").onChange((v) => (data.review = v));
			a.inputEl.rows = 3;
			a.inputEl.addClass("bt-textarea");
		});

		new Setting(contentEl).setName("Favourite quotes").addTextArea((a) => {
			a.setPlaceholder("One quote per line...").onChange((v) => (data.quotes = v));
			a.inputEl.rows = 3;
			a.inputEl.addClass("bt-textarea");
		});

		new Setting(contentEl).setName("Themes (comma-separated)").addText((t) =>
			t.setPlaceholder("e.g. identity, power, memory").onChange((v) => (data.themes = v))
		);

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Add Book").setCta().onClick(async () => {
				if (!data.title.trim()) { new Notice("Title is required."); return; }
				await this.plugin.createBook(data);
				this.onDone();
				this.close();
			})
		);
	}

	onClose() { this.contentEl.empty(); }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class BookTrackerPlugin extends Plugin {
	settings: BookTrackerSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(LIBRARY_VIEW_TYPE, (leaf) => new LibraryView(leaf, this));

		this.addCommand({
			id: "add-book",
			name: "Add book",
			callback: () => this.openAddBookModal(),
		});

		this.addCommand({
			id: "open-library",
			name: "Open library",
			callback: () => this.openLibraryView(),
		});

		this.addRibbonIcon("book-open", "Book Library", () => this.openLibraryView());
		this.addSettingTab(new BookTrackerSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(LIBRARY_VIEW_TYPE);
	}

	openAddBookModal(onDone?: () => void) {
		new AddBookModal(this.app, this, onDone ?? (() => {})).open();
	}

	async ensureFolder(path: string) {
		if (!(await this.app.vault.adapter.exists(path))) {
			await this.app.vault.createFolder(path);
		}
	}

	async createBook(data: BookData): Promise<TFile> {
		await this.ensureFolder(this.plugin_settings().booksFolder);

		const quotesSection = data.quotes.trim()
			? "\n## Favourite Quotes\n\n" +
			  data.quotes
					.split("\n")
					.filter((l) => l.trim())
					.map((l) => `> ${l}`)
					.join("\n\n") +
			  "\n"
			: "";

		const themeLinks = data.themes
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean)
			.map((t) => `[[${t}]]`)
			.join(", ");

		const body = `---
title: "${data.title}"
author: "${data.author}"
genre: "${data.genre}"
year: "${data.year}"
pages: ${data.pages || "null"}
status: ${data.status}
rating: ${data.rating}
date_added: ${moment().format("YYYY-MM-DD")}
themes: [${data.themes.split(",").map((t) => `"${t.trim()}"`).filter(Boolean).join(", ")}]
---

## Review

${data.review || "_No review yet._"}
${quotesSection}
## Themes

${themeLinks || "_No themes linked._"}

## Notes

`;
		const filename = `${this.plugin_settings().booksFolder}/${data.title}.md`;
		const file = await this.app.vault.create(filename, body);

		// Create theme notes if they don't exist
		if (data.themes.trim()) {
			await this.ensureFolder(this.plugin_settings().themesFolder);
			for (const theme of data.themes.split(",").map((t) => t.trim()).filter(Boolean)) {
				const themePath = `${this.plugin_settings().themesFolder}/${theme}.md`;
				if (!(await this.app.vault.adapter.exists(themePath))) {
					await this.app.vault.create(themePath, `# ${theme}\n\nBooks exploring this theme:\n`);
				}
			}
		}

		if (this.settings.autoOpenBook) {
			await this.app.workspace.openLinkText(file.path, "", false);
		}
		new Notice(`Added: ${data.title}`);
		return file;
	}

	plugin_settings() { return this.settings; }

	async openLibraryView() {
		const existing = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
		if (existing.length) {
			this.app.workspace.revealLeaf(existing[0]);
			(existing[0].view as LibraryView).render();
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class BookTrackerSettingTab extends PluginSettingTab {
	plugin: BookTrackerPlugin;

	constructor(app: App, plugin: BookTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Book Tracker" });

		new Setting(containerEl).setName("Books folder").addText((t) =>
			t.setValue(this.plugin.settings.booksFolder).onChange(async (v) => {
				this.plugin.settings.booksFolder = v;
				await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl).setName("Themes folder").addText((t) =>
			t.setValue(this.plugin.settings.themesFolder).onChange(async (v) => {
				this.plugin.settings.themesFolder = v;
				await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl).setName("Auto-open new book notes").addToggle((t) =>
			t.setValue(this.plugin.settings.autoOpenBook).onChange(async (v) => {
				this.plugin.settings.autoOpenBook = v;
				await this.plugin.saveSettings();
			})
		);
	}
}
