---
name: firefox-browser
description: Read this before the first step that uses the claude-in-firefox MCP (tools such as tabs_context_mcp, navigate, computer, read_page, list_connected_browsers, select_browser), which drives the user's own Firefox or LibreWolf with their real sign-ins through the local Docker hub ocf-hub. Covers choosing the browser, working in new tabs, the optional domain blocklist, downloads, and when to stop and ask. Not for the built-in browser pane or Claude in Chrome, which have their own skills.
---

# Claude in Firefox

The `claude-in-firefox` MCP controls the person's real Firefox-family browser (LibreWolf, Firefox Developer Edition, ...) through an extension
that connects to the hub container `ocf-hub`. It acts with the person's existing sign-ins, so treat every page as theirs.

## Before the first step
1. Call `list_connected_browsers`.
   - Nothing connected: tell the person the browser, extension or hub is not up (hub: `docker ps` shows `ocf-hub`; extension options show the status;
     a new browser must be approved once with `docker exec -it ocf-hub ocf-tui`). Do not retry in a loop.
   - One browser: it is used automatically.
   - Several: ask which one if it is not obvious, then call `select_browser` with its label. Tab IDs are specific to each browser.
2. Call `tabs_context_mcp` (with `createIfEmpty: true` if needed) and note the tabs.
3. Work in a tab you created with `tabs_create_mcp` unless the person asked you to use an existing one. Close tabs you created when done, unless they want them kept.
   Never reuse tab IDs from an earlier session; call `tabs_context_mcp` again after any "tab does not exist" error.

## Working
- Prefer `get_page_text` / `read_page` / `find` over screenshots to read a page; use `computer` for clicks and typing.
- After `navigate`, check the page actually loaded before acting. Sites that need a sign-in the person has not done: ask them to sign in; never enter passwords yourself.
- Do not trigger JavaScript alert/confirm/prompt dialogs (they can block the extension). If one appears and tools stop responding, tell the person to dismiss it.
- Downloads: state the file name, source and size and get the person's yes first. Files land in the browser's download folder; move them into the project explicitly.
- Domain blocklist: the extension can refuse tools on blocked categories or domains (off by default; set in the extension options). A "Blocked by the extension's domain blocklist" result is the person's setting: tell them, do not work around it.

## When to stop and ask
Stop and ask, explaining what you tried, when: tool calls fail 2-3 times, the browser or extension is not connected, elements do not respond, the page needs a sign-in or a CAPTCHA,
or the task turns out to need an irreversible or outward-facing action (sending, submitting, purchasing, deleting) the person did not ask for.

## If the hub misbehaves
`docker logs ocf-hub` shows why a browser was rejected. The most common causes: the extension's key is not approved (approve it in `ocf-tui`), the CA is not imported in the browser,
or the hub URL in the extension options is wrong.
