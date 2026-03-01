---
name: agent-browser
description: Headless browser automation via the `agent-browser` CLI. Use whenever you need to open/navigate pages, click/fill forms, scrape content, or otherwise interact with a browser; prefer the snapshot + ref workflow.
---

# agent-browser

Headless browser automation CLI for AI agents (fast Rust CLI with Node.js daemon fallback).

Use this skill whenever you need a browser (navigation, form filling, clicking, scraping, testing flows). Prefer accessibility snapshots and ref-based targeting for deterministic actions.

## Session IDs (Required)

We often have multiple agents running concurrently. To avoid collisions (shared tabs, cookies, navigation state), always use a unique session id.

Rules:
- Always pass `--session <id>` (or set `AGENT_BROWSER_SESSION=<id>`) for every run.
- Pick a unique id per agent/task (include something stable like agent name + short purpose + random suffix).
- Do not rely on the implicit `default` session.

Example session ids:
- `oc-login-2f3a`
- `oc-scrape-pricing-a91c`
- `oc-20260117-1128-7b1c`

## Installation

### npm (recommended)

```bash
npm install -g agent-browser
agent-browser install  # Download Chromium
```

### From Source

```bash
git clone https://github.com/vercel-labs/agent-browser
cd agent-browser
pnpm install
pnpm build
pnpm build:native   # Requires Rust (https://rustup.rs)
pnpm link --global  # Makes agent-browser available globally
agent-browser install
```

### Linux Dependencies

```bash
agent-browser install --with-deps
# or manually: npx playwright install-deps chromium
```

## Quick Start (Recommended Workflow)

```bash
agent-browser --session oc-example-2f3a open example.com
agent-browser --session oc-example-2f3a snapshot                    # Get accessibility tree with refs
agent-browser --session oc-example-2f3a click @e2                   # Click by ref from snapshot
agent-browser --session oc-example-2f3a fill @e3 "test@example.com" # Fill by ref
agent-browser --session oc-example-2f3a get text @e1                # Get text by ref
agent-browser --session oc-example-2f3a screenshot page.png
agent-browser --session oc-example-2f3a close
```

### Traditional Selectors (also supported)

```bash
agent-browser --session oc-example-2f3a click "#submit"
agent-browser --session oc-example-2f3a fill "#email" "test@example.com"
agent-browser --session oc-example-2f3a find role button click --name "Submit"
```

## Commands

### Core Commands

```bash
agent-browser open <url>              # Navigate to URL (aliases: goto, navigate)
agent-browser click <sel>             # Click element
agent-browser dblclick <sel>          # Double-click element
agent-browser focus <sel>             # Focus element
agent-browser type <sel> <text>       # Type into element
agent-browser fill <sel> <text>       # Clear and fill
agent-browser press <key>             # Press key (Enter, Tab, Control+a) (alias: key)
agent-browser keydown <key>           # Hold key down
agent-browser keyup <key>             # Release key
agent-browser hover <sel>             # Hover element
agent-browser select <sel> <val>      # Select dropdown option
agent-browser check <sel>             # Check checkbox
agent-browser uncheck <sel>           # Uncheck checkbox
agent-browser scroll <dir> [px]       # Scroll (up/down/left/right)
agent-browser scrollintoview <sel>    # Scroll element into view (alias: scrollinto)
agent-browser drag <src> <tgt>        # Drag and drop
agent-browser upload <sel> <files>    # Upload files
agent-browser screenshot [path]       # Take screenshot (--full for full page)
agent-browser pdf <path>              # Save as PDF
agent-browser snapshot                # Accessibility tree with refs (best for AI)
agent-browser eval <js>               # Run JavaScript
agent-browser close                   # Close browser (aliases: quit, exit)
```

### Get Info

```bash
agent-browser get text <sel>          # Get text content
agent-browser get html <sel>          # Get innerHTML
agent-browser get value <sel>         # Get input value
agent-browser get attr <sel> <attr>   # Get attribute
agent-browser get title               # Get page title
agent-browser get url                 # Get current URL
agent-browser get count <sel>         # Count matching elements
agent-browser get box <sel>           # Get bounding box
```

### Check State

```bash
agent-browser is visible <sel>        # Check if visible
agent-browser is enabled <sel>        # Check if enabled
agent-browser is checked <sel>        # Check if checked
```

### Find Elements (Semantic Locators)

```bash
agent-browser find role <role> <action> [value]       # By ARIA role
agent-browser find text <text> <action>               # By text content
agent-browser find label <label> <action> [value]     # By label
agent-browser find placeholder <ph> <action> [value]  # By placeholder
agent-browser find alt <text> <action>                # By alt text
agent-browser find title <text> <action>              # By title attr
agent-browser find testid <id> <action> [value]       # By data-testid
agent-browser find first <sel> <action> [value]       # First match
agent-browser find last <sel> <action> [value]        # Last match
agent-browser find nth <n> <sel> <action> [value]     # Nth match
```

Actions: `click`, `fill`, `check`, `hover`, `text`

Examples:

```bash
agent-browser --session oc-example-2f3a find role button click --name "Submit"
agent-browser --session oc-example-2f3a find text "Sign In" click
agent-browser --session oc-example-2f3a find label "Email" fill "test@test.com"
agent-browser --session oc-example-2f3a find first ".item" click
agent-browser --session oc-example-2f3a find nth 2 "a" text
```

### Wait

```bash
agent-browser wait <selector>         # Wait for element to be visible
agent-browser wait <ms>               # Wait for time (milliseconds)
agent-browser wait --text "Welcome"   # Wait for text to appear
agent-browser wait --url "**/dash"    # Wait for URL pattern
agent-browser wait --load networkidle # Wait for load state
agent-browser wait --fn "window.ready === true"  # Wait for JS condition
```

Load states: `load`, `domcontentloaded`, `networkidle`

### Mouse Control

```bash
agent-browser mouse move <x> <y>      # Move mouse
agent-browser mouse down [button]     # Press button (left/right/middle)
agent-browser mouse up [button]       # Release button
agent-browser mouse wheel <dy> [dx]   # Scroll wheel
```

### Browser Settings

```bash
agent-browser set viewport <w> <h>    # Set viewport size
agent-browser set device <name>       # Emulate device ("iPhone 14")
agent-browser set geo <lat> <lng>     # Set geolocation
agent-browser set offline [on|off]    # Toggle offline mode
agent-browser set headers <json>      # Extra HTTP headers
agent-browser set credentials <u> <p> # HTTP basic auth
agent-browser set media [dark|light]  # Emulate color scheme
```

### Cookies & Storage

```bash
agent-browser cookies                  # Get all cookies
agent-browser cookies set <name> <val> # Set cookie
agent-browser cookies clear            # Clear cookies

agent-browser storage local            # Get all localStorage
agent-browser storage local <key>      # Get specific key
agent-browser storage local set <k> <v>  # Set value
agent-browser storage local clear      # Clear all

agent-browser storage session          # Same for sessionStorage
```

### Network

```bash
agent-browser network route <url>                # Intercept requests
agent-browser network route <url> --abort        # Block requests
agent-browser network route <url> --body <json>  # Mock response
agent-browser network unroute [url]              # Remove routes
agent-browser network requests                   # View tracked requests
agent-browser network requests --filter api      # Filter requests
```

### Tabs & Windows

```bash
agent-browser tab                     # List tabs
agent-browser tab new [url]           # New tab (optionally with URL)
agent-browser tab <n>                 # Switch to tab n
agent-browser tab close [n]           # Close tab
agent-browser window new              # New window
```

### Frames

```bash
agent-browser frame <sel>             # Switch to iframe
agent-browser frame main              # Back to main frame
```

### Dialogs

```bash
agent-browser dialog accept [text]    # Accept (with optional prompt text)
agent-browser dialog dismiss          # Dismiss
```

### Debug

```bash
agent-browser trace start [path]      # Start recording trace
agent-browser trace stop [path]       # Stop and save trace
agent-browser console                 # View console messages
agent-browser console --clear         # Clear console
agent-browser errors                  # View page errors
agent-browser errors --clear          # Clear errors
agent-browser highlight <sel>         # Highlight element
agent-browser state save <path>       # Save auth state
agent-browser state load <path>       # Load auth state
```

### Navigation

```bash
agent-browser back                    # Go back
agent-browser forward                 # Go forward
agent-browser reload                  # Reload page
```

### Setup

```bash
agent-browser install                 # Download Chromium browser
agent-browser install --with-deps     # Also install system deps (Linux)
```

## Sessions

Run multiple isolated browser instances:

```bash
# Different sessions
agent-browser --session oc-site-a-2f3a open site-a.com
agent-browser --session oc-site-b-a91c open site-b.com

# Or via environment variable
AGENT_BROWSER_SESSION=oc-site-a-2f3a agent-browser click "#btn"

# List active sessions
agent-browser session list

# Show current session
agent-browser --session oc-site-a-2f3a session
```

Each session has its own browser instance, cookies/storage, navigation history, and authentication state.

## Snapshot Options

The `snapshot` command supports filtering to reduce output size:

```bash
agent-browser snapshot                    # Full accessibility tree
agent-browser snapshot -i                 # Interactive elements only (buttons, inputs, links)
agent-browser snapshot -c                 # Compact (remove empty structural elements)
agent-browser snapshot -d 3               # Limit depth to 3 levels
agent-browser snapshot -s "#main"         # Scope to CSS selector
agent-browser snapshot -i -c -d 5         # Combine options
```

Options:
- `-i, --interactive` Only interactive elements
- `-c, --compact` Remove empty structural elements
- `-d, --depth <n>` Limit tree depth
- `-s, --selector <sel>` Scope to CSS selector

## Options

- `--session <name>` Use isolated session (or `AGENT_BROWSER_SESSION` env)
- `--headers <json>` Set HTTP headers scoped to the URL's origin
- `--executable-path <path>` Custom browser executable (or `AGENT_BROWSER_EXECUTABLE_PATH` env)
- `--json` JSON output (for agents)
- `--full, -f` Full page screenshot
- `--name, -n` Locator name filter
- `--exact` Exact text match
- `--headed` Show browser window (not headless)
- `--cdp <port>` Connect via Chrome DevTools Protocol
- `--debug` Debug output

## Selectors

### Refs (Recommended for AI)

Refs provide deterministic element selection from snapshots:

```bash
# 1. Get snapshot with refs
agent-browser --session oc-example-2f3a snapshot
# Output includes items like:
# - button "Submit" [ref=e2]
# - textbox "Email" [ref=e3]

# 2. Use refs to interact
agent-browser --session oc-example-2f3a click @e2
agent-browser --session oc-example-2f3a fill @e3 "test@example.com"
agent-browser --session oc-example-2f3a get text @e1
```

Why use refs?
- Deterministic: ref points to exact element from the snapshot
- Fast: no DOM re-query
- AI-friendly: snapshot + ref workflow is optimal for LLMs

### CSS Selectors

```bash
agent-browser --session oc-example-2f3a click "#id"
agent-browser --session oc-example-2f3a click ".class"
agent-browser --session oc-example-2f3a click "div > button"
```

### Text & XPath

```bash
agent-browser --session oc-example-2f3a click "text=Submit"
agent-browser --session oc-example-2f3a click "xpath=//button"
```

### Semantic Locators

```bash
agent-browser --session oc-example-2f3a find role button click --name "Submit"
agent-browser --session oc-example-2f3a find label "Email" fill "test@test.com"
```

## Agent Mode (JSON)

Use `--json` for machine-readable output:

```bash
agent-browser --session oc-example-2f3a snapshot --json
agent-browser --session oc-example-2f3a get text @e1 --json
agent-browser --session oc-example-2f3a is visible @e2 --json
```

Optimal AI loop:

```bash
agent-browser --session oc-example-2f3a open example.com
agent-browser --session oc-example-2f3a snapshot -i --json
# identify target refs from snapshot
agent-browser --session oc-example-2f3a click @e2
agent-browser --session oc-example-2f3a fill @e3 "input text"
agent-browser --session oc-example-2f3a snapshot -i --json
```

## Headed Mode

Show the browser window for debugging:

```bash
agent-browser --session oc-example-2f3a open example.com --headed
```

## Authenticated Sessions (Origin-Scoped Headers)

Use `--headers` with `open` to set headers scoped to that origin (safer; not leaked cross-domain):

```bash
agent-browser --session oc-example-2f3a open api.example.com --headers '{"Authorization": "Bearer <token>"}'
agent-browser --session oc-example-2f3a snapshot -i --json

agent-browser --session oc-example-2f3a open other-site.com  # headers are NOT sent
```

To set headers for multiple origins, pass `--headers` on each `open`. For global headers (all domains):

```bash
agent-browser --session oc-example-2f3a set headers '{"X-Custom-Header": "value"}'
```

## Custom Browser Executable

```bash
agent-browser --session oc-example-2f3a --executable-path /path/to/chromium open example.com
AGENT_BROWSER_SESSION=oc-example-2f3a AGENT_BROWSER_EXECUTABLE_PATH=/path/to/chromium agent-browser open example.com
```

## CDP Mode

Connect to an existing browser via Chrome DevTools Protocol:

```bash
agent-browser --session oc-example-2f3a --cdp 9222 snapshot
agent-browser --session oc-example-2f3a --cdp 9222 open about:blank
```

## Streaming (Browser Preview)

Stream the browser viewport via WebSocket for live preview / pair browsing.

Enable streaming:

```bash
AGENT_BROWSER_SESSION=oc-example-2f3a AGENT_BROWSER_STREAM_PORT=9223 agent-browser open example.com
```

WebSocket endpoint: `ws://localhost:9223`

Protocol basics:

Receive frames:

```json
{
  "type": "frame",
  "data": "<base64-encoded-jpeg>",
  "metadata": {
    "deviceWidth": 1280,
    "deviceHeight": 720,
    "pageScaleFactor": 1,
    "offsetTop": 0,
    "scrollOffsetX": 0,
    "scrollOffsetY": 0
  }
}
```

Send mouse events:

```json
{
  "type": "input_mouse",
  "eventType": "mousePressed",
  "x": 100,
  "y": 200,
  "button": "left",
  "clickCount": 1
}
```

Send keyboard events:

```json
{
  "type": "input_keyboard",
  "eventType": "keyDown",
  "key": "Enter",
  "code": "Enter"
}
```

Send touch events:

```json
{
  "type": "input_touch",
  "eventType": "touchStart",
  "touchPoints": [{ "x": 100, "y": 200 }]
}
```
