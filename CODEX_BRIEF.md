# Bug: Search doesn't work in archive.html

## The file
`archive.html` is a single self-contained HTML file (~166KB) with all CSS inline in `<style>` and all JS inline in a `<script>` tag. The JS contains ~95KB of inline JSON data (var IDX, var TL, var WD) plus ~18KB of application logic.

## What works
- The page renders (header, search bar, timeline cards all display)
- The data loads correctly (verified: IDX has 848 entries, TL has 16, WD has 16)
- A diagnostic inserted before `renderTimeline()` at the end of the script confirms "FULL SCRIPT LOADED"
- When the data + search logic are extracted into a minimal standalone page, search works perfectly

## What doesn't work
- Typing in the search input (id="search") produces no results
- No visible JavaScript errors in the console (in the Claude.ai sandbox environment)
- Adding `window.onerror` handler and try/catch around each `addEventListener` call produced NO error messages AND NO success indicators, suggesting those code paths aren't executing at all despite the script "loading"

## Suspected cause
The `<script>` block previously had 98 instances of `</` in string literals (like `</span>`, `</div>`) which were breaking the HTML parser. These were all replaced with `<\/` and the script compiles and runs correctly in Node.js VM. However, search still doesn't work in the browser.

The diagnostic code added at the END of the script (before `renderTimeline()`) executes. But the `addEventListener` calls that come AFTER `renderTimeline()` and `initFromURL()` seem to not execute, even though no errors are thrown.

## Key code structure (bottom of script)
```
renderTimeline();    // <-- this runs (confirmed)  
initFromURL();       // <-- this probably runs

// These event listeners seem to never execute:
document.getElementById('filters').addEventListener('click', ...);
document.getElementById('search').addEventListener('input', ...);
document.querySelector('.search-hint').addEventListener('click', ...);
```

## What to fix
Make the search input work. When a user types in the input with id="search", it should call `doSearch()` which filters the IDX array and renders results into the `#results-list` div.

## Environment
- Tested in Claude.ai sandbox (srcdoc iframe) - `history.pushState` throws SecurityError here, which is handled with try/catch
- Will ultimately be deployed to a normal web server (Vercel)
- No frameworks, no build step, vanilla JS only, ES5-compatible (no arrow functions, no template literals)
