# Loreloom launch kit

Ready-to-paste copy for Product Hunt, Hacker News, Reddit and X.
Repo: https://github.com/prabhavmakkar/loreloom

## Product Hunt

**Name:** Loreloom

**Tagline (60 chars max):** A local writing app for novelists, with an AI helper

**Topics:** Writing, Open Source, Artificial Intelligence, Productivity

**Links:** https://github.com/prabhavmakkar/loreloom

**Pricing:** Free (open source, MIT)

**Description (260 chars max):**
Loreloom is a free, open-source writing app for novelists. Write chapters,
track pages, map your characters and keep a dictionary of your world. Its AI
helper brainstorms, drafts and reviews using your own Claude Code login, so
there are no extra AI fees.

**Gallery:** docs/screenshot.png, docs/screenshot-write.png (add a short GIF
of drafting a scene if you can)

**Maker's first comment:**
Hi Product Hunt! I started writing a fantasy novel and got stuck in writer's
block. The writing tools I tried either had no AI, or charged extra for AI on
top of the Claude subscription I already pay for.

So I built Loreloom:

- A calm editor with chapters, page counts and drag-to-reorder
- A world library: characters, places, rules of magic, and a glossary of
  invented words. Type @ to link them in your prose.
- A character map showing who is connected to whom
- An AI helper with three modes: Brainstorm, Draft and Review. It reads your
  world notes, so its suggestions fit your story's rules. It never changes
  your chapters unless you click.

It runs on your own computer, and your book is saved as plain Markdown files
you own. The AI runs through your own Claude Code sign-in, so no API keys
and no extra fees. Loreloom never sees your credentials.

It's MIT-licensed and early. I'd love to hear what you'd want from it.

## Hacker News (Show HN)

**Title:** Show HN: Loreloom – a local-first novel-writing app with an AI helper

**Text:**
I built this to get unstuck on a fantasy novel. It's a local web app (Node +
React + TipTap). Your book is a folder of Markdown files with YAML
frontmatter: chapters, characters, places, rules and a glossary. The AI
helper shells out to the official `claude` CLI in headless mode, using
whatever account you're signed into, with tools restricted to read-only
(Read/Grep/Glob) on your book folder. It never touches credentials and only
reads `claude auth status` to show whether you're signed in. There's also an
MCP server, so you can use the same book from Claude Code directly.
Feedback on the file format and the AI workflow especially welcome.
https://github.com/prabhavmakkar/loreloom

## Reddit (r/writing tools threads, r/fantasywriters weekly threads, r/selfhosted, r/opensource)

Check each subreddit's self-promotion rules first. Many only allow it in a
weekly thread.

**Title:** I made a free, open-source writing app for my fantasy novel: chapters, character map, world glossary and an optional AI helper

**Body:** use the Product Hunt maker comment, plus the repo link.

## X / LinkedIn

I got stuck writing my fantasy novel, so I built the writing app I wanted.

Loreloom: chapters + page counts, a character map, a dictionary for your
world, and an AI helper that brainstorms, drafts and reviews using your own
Claude subscription. Local, free, open source.

https://github.com/prabhavmakkar/loreloom
