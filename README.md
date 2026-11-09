# Web Project Change Impact Visualizer

A local developer tool that scans a web project and builds a map of how its files connect. Select a file before editing to see other files that may be affected, such as HTML pages and their CSS or JavaScript, module imports, asset references, and JavaScript API calls. Each connection includes its source line when available. Treat the results as a review guide: static scanning cannot guarantee that a change will or will not cause a problem. The graph uses directed references: an edge from A to B means A depends on or refers to B.

## Setup

Requires Node.js 20 or later.

```sh
npm install
npm run typecheck
npm test
npm run build
```

## Use

Start the CLI against a project (build the web UI first so the server can serve it):

```sh
npm run build
npm run impact-viz -- ./sample-project
```

The CLI starts the local server on an available loopback port and opens the browser. To use the development UI, run `npm run server -- ./sample-project` and `npm run dev` in separate terminals; open `http://localhost:5173`.

Print impact for one project relative file:

```sh
npm run impact-viz -- ./sample-project --changed main.js
```

Print combined impact for files changed between `HEAD` and the working tree:

```sh
npm run impact-viz -- . --git-diff
```

The UI supports reverse impact, forward dependencies, both directions, path search, type and confidence filters, explanations with relationship and line number, folder compound nodes, and dark/light themes. API calls produce endpoint nodes. Dynamic URLs and unresolved local references have possible confidence. Warnings from malformed files are reported while scanning continues.

The web UI also has **Upload project** for selecting a local folder and **Upload files** for individual files. The selected text files are sent to the local server for scanning and replace the currently displayed graph. Uploads are limited to 500 files and 2 MB per file. The scanner currently extracts relationships from HTML, CSS, and JavaScript/TypeScript; other files appear in the graph as project assets.

## Architecture

- `packages/core`: scanner, JS/HTML/CSS parsers, path resolution, graph construction and breadth first impact traversal.
- `packages/server`: Express API and CLI. The API serves JSON graph/impact endpoints and the built web app.
- `packages/web`: React, Vite and Cytoscape graph UI.
- `sample-project`: small demo with an HTML entry point, stylesheet, JS modules, assets, and API call.

The scanner respects `.gitignore` and skips `node_modules`, `dist`, `build`, and `.git`. JavaScript imports support relative paths, extension and index resolution, and basic `tsconfig.json` paths aliases. CSS imports and `url()` references are included. API calls detected include `fetch`, common `axios` methods, and `XMLHttpRequest.open` when the URL is a string or template literal.
