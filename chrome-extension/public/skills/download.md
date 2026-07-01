---
name: download
description: Save data to a real file on the user's disk. Most often used right after `scrape` to export the collected items.
when_to_use: User says "download", "export", "save", "indir", "kaydet", "as CSV / JSON / Excel / file", or otherwise asks for a real file (not a chat preview). Default-format inference is fine when they didn't specify.
argument-hint: [filename] [as csv|json|tsv|txt|md]
allowed-tools: [run_js, memory_count, scrape]
version: 9
---

The user wants a real file on disk — not a markdown table in the chat.

Pick the source of the data, in this order:
- A working-memory bucket from a recent `scrape`. Call `memory_count` first to see what's there. This is the default after a scrape.
- The live page, if the data is still rendered and there was no scrape.
- A small inline list, only as a last resort.

Pick the format. Honour what the user asked. Otherwise: flat tabular → CSV; nested or mixed shapes → JSON; one-string-per-line → TXT. After a typical scrape, CSV is usually right.

Pick a filename that names the data domain (`amazon-products.csv`, `linkedin-comments.json`, `links.txt`) — not `export.csv` or `data.json`. If the user gave one, trust it.

Trigger the download. The system prompt covers the mechanic; a single `run_js` call is enough. After it succeeds, surface a one-line confirmation with the row count from the script's own return value (don't fabricate numbers). If the count is missing or zero, something went wrong — say so honestly rather than claiming success.

Refuse politely if the active tab is `chrome://`, `edge://`, or another browser-internal page — anchor downloads don't work there. Ask the user to switch tabs.
