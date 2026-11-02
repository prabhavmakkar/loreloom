# Loreloom — design

*Working name, builder's call; easy to change before the first public release.*

## 1. Intent

A local, open-source writing app for novelists (starting with fantasy), with an AI helper that knows the author's book. The first user is the author of this document. They're writing a fantasy novel, are currently stuck in writer's block, and want somewhere they can start writing **now**. They'll learn what actually gets in the way and improve the tool from there.

The AI runs on **each writer's own Claude subscription**, through the official Claude Code CLI installed on their machine. That's much cheaper for writers than buying API credits, and it's the reason the project gets open-sourced: anyone with a Claude plan can clone it and use it.

**Success for v1:** the author opens the app, writes in it day to day, and gets unstuck with the helper's brainstorming, drafting and review, without the helper contradicting their world.

## 2. Goals (v1)

1. **A writing editor** for a book made of chapters, as polished as a modern online editor.
2. **Visible progress:** total pages, chapters, words, and pages per chapter.
3. **A world library** with four shelves: Characters, Places, Rules (magic, laws, what's forbidden) and Glossary (fantasy terms, kept like a dictionary a reader could flip through).
4. **Pulling in existing characters** while writing (and places, rules, terms): typing `@` links to an existing card.
5. **A character map:** a graph of characters and the relationships between them.
6. **An AI helper with three modes:**
   - **Brainstorm:** a chat for getting unstuck.
   - **Draft:** writes prose on request.
   - **Review:** gives suggestions on what the author wrote.
7. **An MCP server** over the same book, so the author can also work on the book from Claude Desktop or Claude Code.
8. **Ready to open-source:** a clean repository with a license, README and setup instructions that a writer with a Claude plan can follow.

## 3. Non-goals (v1, possibly later)

- Hosting, cloud sync, accounts, multiple users, real-time collaboration.
- The AI automatically finding new characters or events in chapters and proposing cards. This is the most likely next feature, so the design shouldn't block it.
- Review notes shown inline in the margin. In v1, suggestions appear in the helper panel.
- Export to ePub, docx or PDF.
- A packaged desktop app (Tauri or Electron) and a mobile layout.
- Version history inside the app. The book is plain files, so git covers this for now.

## 4. Anti-goals (a failure even if it works)

- **The app touching Claude credentials.** It must never read, store, copy or forward OAuth tokens or session files. Sign-in always happens in Anthropic's own `claude` login flow. (See §6.)
- **The AI changing the author's prose without consent.** The helper proposes; only the author inserts or replaces text.
- **Lock-in.** The book has to stay readable and editable without the app: plain Markdown files in a folder.
- **A cluttered workspace** that gets between the author and the page. The page is the centre of the app.
- **A helper that ignores the world**, inventing facts that contradict the cards.

## 5. What the author decided

- **Layout: "the writer's desk"** (chosen from three mockups; `.superpowers/brainstorm/…/layout.html`):
  - **Top bar:** book title, then "N pages · N chapters · N words", then view switch: *Write · World · Chapters*.
  - **Left sidebar:** the chapter list with a page count per chapter, then the World shelves with counts (Characters, Places, Rules, Glossary).
  - **Centre:** the page for the current chapter.
  - **Right:** the helper panel, open by default, with *Brainstorm / Draft / Review* tabs.
  - **The character map** opens as its own full view (the "World" view).
- **Relationships on the map** come from character cards, added by the author in v1 (e.g. Mira → *trusts* → Kael).
- **The author writes sometimes and the AI drafts sometimes.** Both have to feel first-class.
- **The AI uses the writer's own Claude subscription** through their locally installed Claude Code, not API credits.
- **An open-source release** on the author's GitHub.
- **All tools and technology are the builder's call** (the author delegated this).
- **Ship small, then iterate.**

## 6. Constraints

### Anthropic's terms (checked 2026-11-02 against code.claude.com/docs/en/legal-and-compliance)

- Third-party developers may not offer Claude.ai login in their own apps, or route requests through a user's subscription credentials, and may not "collect, store, or intermediate Claude.ai credentials or session tokens".
- It is explicitly allowed for "an end user [to sign] in to the unmodified Claude Code binary with their own Claude subscription".
- **Therefore:** the app runs the user's own installed, unmodified `claude` binary as a subprocess. The user signs in themselves (`claude` → `/login`). The app never touches credentials. It doesn't use the Agent SDK with subscription auth, and it never reads `~/.claude` credential files.
- An **optional API-key provider** is planned (interface in v1, implementation later) so the project survives if this changes, and so users without a subscription can use it.
- **Naming:** neither "Claude" nor "Anthropic" may be in the product name or logo. The README may say in plain text that it "runs Claude Code".
- Subscription usage limits are shared with the user's other Claude use, so context sent to the AI should be lean (see §7.4).

### Environment

- Node 22 is available (no pnpm), and Claude Code 2.1.x is installed.
- macOS is primary; it should also work on Linux and Windows wherever Node and `claude` run.

## 7. Builder's calls (decided here; may be revised)

### 7.1 Stack

- **TypeScript throughout, npm workspaces, MIT license.**
- **Packages:**
  - `core`: the book format, reading and writing, stats, and context assembly.
  - `server`: a local HTTP API plus the AI bridge.
  - `web`: the user interface.
  - `mcp`: a stdio MCP server.
- **Server:** Node with Hono, bound to `127.0.0.1` only. Started with one command (`npm start -- ./path/to/book`, later `npx loreloom ./my-book`), which opens the browser. *Builder's call:* the first public release is clone-and-`npm start`. Publishing to npm comes later, after checking the name is available.
- **Web:** Vite + React.
  - Editor: **TipTap** (ProseMirror), using the Mention extension for `@` links.
  - Graph: **Cytoscape.js**, with an automatic layout and draggable nodes.
- **Tests:** Vitest. `core` and the AI bridge are covered by tests, the bridge against a fake `claude` script. UI tests are light.
- **CI:** a GitHub Actions workflow that runs typecheck and tests.

### 7.2 Book format (a folder; the app opens any folder)

```
my-book/
  book.yaml                  # title, author, wordsPerPage (default 250)
  chapters/
    01-the-ember-gate.md     # frontmatter: id, title, order, status, summary
  world/
    characters/kael.md       # frontmatter: id, name, aliases, role, relationships:[{to, kind, note}]
    places/ember-gate.md
    rules/iron-and-ember.md
    glossary/ashbound.md     # frontmatter: term, pronunciation?, short definition; body = longer entry
  .loreloom/                 # app state (helper sessions, UI prefs); safe to delete or gitignore
```

- Chapters are stored as Markdown. Mentions are written as `[Kael](@character/kael)`, so they still read cleanly as plain Markdown.
- **Page count:** words ÷ `wordsPerPage`, using 250, the standard manuscript estimate. Pages are shown per chapter and in total.
- **Saving:** the editor autosaves (debounced) and also saves when switching chapters. Writes are atomic: write a temporary file, then rename.
- **Saving is visible and safe** (the author asked for this explicitly): a status in the top bar shows *Saving… / Saved · just now / Not saved: retry*. Unsaved edits are also kept in the browser's local storage until the disk write succeeds, so a crash or a closed tab loses nothing. Leaving the page with unsaved changes asks for confirmation. The README and the first-run screen recommend keeping the book folder in a synced or backed-up location (iCloud Drive or Dropbox) or in its own git repo.
- **Edits made outside the app**, by the author in another editor or by Claude through MCP, are picked up with a file watcher. If a file was changed while it's also open with unsaved edits, the app shows a notice instead of silently overwriting.
- A small **sample book** is included, for first-run and tests.

### 7.3 The views

- **Write:** the layout from §5.
- **World:** the character map in the main area. Clicking a node opens that card. Relationships can be added from the card or by dragging between nodes. Places, Rules and Glossary are browsed as card lists.
- **Chapters:** a grid of chapter cards showing title, summary, status and page count. Cards can be reordered by dragging, and chapters added, renamed or deleted.
- **Visual direction:** warm, bookish and calm, like the mockup (paper tones, a serif for prose, a sans-serif for the interface). Dark mode included. The builder refines the details.

### 7.4 The AI helper

**The bridge.** The server spawns the user's own `claude` with these settings:

- **Mode:** `claude -p`, with streaming JSON output and partial messages, so tokens can be streamed to the browser over SSE.
- **Working directory:** the book folder.
- **System prompt:** a novel-helper system prompt, appended.
- **Tools:** read-only only (Read, Grep, Glob) so it can look things up. No edit, write or shell tools.
- **Conversations:** each continues through Claude Code's session resume. Session ids are kept per book and per mode under `.loreloom/`.

**The context pack.** The server assembles this for each request, kept lean:

- the current chapter, or the selected text plus the surrounding text;
- the cards mentioned in that text, plus cards whose names or aliases appear in it;
- all Rules cards, which are short by convention;
- one-line summaries of the other chapters.

Claude can open anything else in the folder with its read tools.

**What each mode does:**

- **Brainstorm:** a chat. Answers stay grounded in the cards, and the helper offers options rather than one answer.
- **Draft:** the author says what they want ("the next scene where…", or "continue from here"). The prose streams into the panel, with buttons to *Insert at cursor*, *Replace selection*, *Copy* or *Try again*. It never writes into the chapter by itself.
- **Review:** reviews the selection or the whole chapter. It returns structured suggestions: quoted text, the issue, a proposed fix, and a category (prose, pacing, continuity / world rules, dialogue). Each suggestion appears in the panel. Clicking it highlights the quote in the editor, and *Apply* replaces it. Continuity checks against Rules and character cards are the highlight feature.

**Provider interface:** `ClaudeCodeProvider` is the default, and `AnthropicApiProvider` is used when an API key is configured. Both stream the same events. *Builder's call (after review):* v1 ships the interface and `ClaudeCodeProvider` only. `AnthropicApiProvider` is a later milestone, because it has to recreate the read-tools loop that Claude Code provides for free.

**Startup check:**

- If `claude` isn't found, the panel shows an install link.
- If the user isn't signed in (detected from CLI output or exit code, never from credential files), it shows "Open a terminal and run `claude`, then `/login`".
- A cancel button stops the subprocess.

### 7.5 MCP server

- **Transport:** stdio. It's pointed at a book folder by an argument.
- **Tools:**
  - `list_chapters`, `read_chapter`;
  - `list_cards(kind)`, `read_card`;
  - `search_book(query)`, `get_stats`;
  - `create_card`, `update_card`, `add_relationship`.
- **Chapters are read-only over MCP in v1,** to protect the manuscript. Cards can be written.
- The README shows how to add it to Claude Desktop and Claude Code. The running app picks up these changes through the file watcher.

### 7.6 Open-source readiness

- README: what it is; requirements (Node 22, Claude Code, a Claude plan or an API key); a quick start; the MCP setup; and a short, factual note on how authentication works, linking Anthropic's terms.
- Also included: `LICENSE` (MIT), `CONTRIBUTING.md`, a `.gitignore` (excluding `.superpowers/`, `.loreloom/` and `node_modules`), and the CI workflow.
- The author's own novel lives in a **separate folder outside the app repo**, so their manuscript is never pushed by accident. Suggested: `Fantasy Novel/book/` with its own git if wanted, and the app in `Fantasy Novel/loreloom/`.

### 7.7 Build order (decided by the author)

The author has no existing manuscript or notes, so there's no importer. First run offers **"New book"** (title and author, which creates the folder structure) and **"Open sample book"**.

All of v1 gets built, in this order. Each milestone should be usable on its own:

1. **Write:** the editor, the chapters list and Chapters view, page, word and chapter counts, the four World shelves with card editing, `@` mentions, autosave, and the file watcher. Plus the helper's **Brainstorm** and **Draft** modes through `ClaudeCodeProvider`.
2. **Review and the map:** **Review** mode (including continuity against Rules and characters), and the **World** view with the character map.
3. **Connector and release:** the **MCP server**, the README, license, contributing guide and CI, ready for the author's GitHub.

## 8. Left to the builder

Exact visual design, component structure, the wording of prompts, keyboard shortcuts, the graph layout algorithm, and how the sample book reads. Anything else not decided above should be decided in the spirit of §4.
