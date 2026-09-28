# Retina

A single-purpose reading surface. Paste text, read it comfortably, clear it when you're done.

## Run

There is no build step and no dependency. Open `index.html` directly, or serve the folder:

```
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Use

- Press ⌘V (Ctrl+V) anywhere on the page, or click "paste from clipboard". Dropping a text file onto the page also works.
- Rich text from web pages, Google Docs, Word, chat apps and code editors keeps its headings, emphasis, links, code, lists and quotes. Plain text is read as light Markdown.
- "Clear" in the top right starts over. Pasting again replaces what's there.
- Press ⌘Z (Ctrl+Z on Windows/Linux) to restore a document removed by Clear or replaced by a paste.
- The last document and scroll position survive a reload.
- Text too small or too large? Use the browser's zoom. Everything scales with it.

## Files

- `index.html` – the page
- `style.css` – the typography and colours; this is where the reading experience lives
- `app.js` – clipboard handling, a small Markdown reader for plain text, and a sanitiser that rebuilds pasted HTML from a safe subset of elements
