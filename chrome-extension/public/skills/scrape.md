---
name: scrape
description: Collect a list of items from the current page (products, search results, comments, jobs, posts, table rows, etc.). Handles pagination when the user wants more than one page.
when_to_use: User says "scrape", "collect", "extract", "get me all the X", "give me a list of Y", "give me the data", or any equivalent in any language. Pair with the `download` skill if the user wants a file.
argument-hint: <what to collect> [from <url>]
allowed-tools: [find, find_elements, read_page, run_js, scroll, computer, navigate, tabs_create, memory_count]
version: 6
---

The user wants to collect a list. Read their request from the conversation; the noun they named is what to collect (products, results, comments…).

Steps:

1. Open the source. If the user named a URL, navigate there. Otherwise use the active tab.
2. Find the list. There's usually one obvious repeating group on the page; pick that one. If multiple plausible lists exist, ask which one in a single short question.
3. Validate first, bulk after. Extract one row to confirm the fields look right, then collect every row on the page into a working-memory bucket. Name the bucket after the data (`products`, `comments`, `jobs`) — not `scraped` or `results`.
4. Decide whether to paginate. Paginate only if the request is clearly "all" / "every" / "the full list" / a specific count. If unclear and the page has Next / Load-more / infinite scroll, ask once before paginating. If only the visible page was wanted, stop after step 3.
5. Pick the right pagination mechanism. If the page has a numbered Next button, click it (a fresh page load — refs reset). If it has Load-more or infinite scroll, do that instead. Two scrolls in a row that add zero items means the bottom has been reached for that mechanism — don't keep scrolling, switch to a Next-page click if one exists, otherwise stop. Don't sit waiting for items that aren't going to load.
6. Stop when there's nothing left — Next button gone, Load-more disappears, the user-given count is reached, or you've exhausted both scroll and pagination.

Report back: total items collected, bucket name, pagination mode used, 3-5 sample rows so the user can sanity-check the shape, and anything you had to skip (login walls, blocked subdomains, missing fields). Do NOT paste the whole list — `download` reads from the bucket. Do NOT invent or pad rows you didn't actually extract.

Then call `done` with a one-line summary that names the bucket and the count.
