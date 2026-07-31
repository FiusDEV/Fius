# Fius

AI-powered CLI and Web platform for coding, reasoning, and real-time collaboration.

## Features

- **CLI Terminal** — chat with AI directly in your terminal
- **Web UI** — browser-based interface with full feature parity
- **Build & Plan Modes** — switch between execution and planning
- **MCP Tools** — filesystem, git, browser, and custom tool support
- **Multi-model** — connect to OpenRouter, OpenAI, Anthropic, Google, and more

## Install

### npm (recommended)

```bash
npm install -g @fiusdev/fius
```

### curl (Linux / macOS)

```bash
curl -fsSL https://fius.dev/install | bash
```

### Homebrew (macOS / Linux)

```bash
brew tap fiusdev/fius
brew install fius
```

### AUR (Arch Linux)

```bash
paru -S fius
```

## Quick Start

```bash
fius
```

Launch the CLI. On first run, you'll be guided through browser-based authentication — no API keys needed.

## Build & Plan Modes

Fius has two modes that control how the AI works:

- **Build mode** — AI plans AND executes: creates files, edits code, runs commands
- **Plan mode** — AI ONLY plans: analyzes, describes architecture, gives recommendations without modifying anything

Switch between modes:
- **CLI**: press `Ctrl+B` or use `/mode`
- **Web**: press `Ctrl+B` (or `⌘B` on Mac) or use the toggle in the header

The current mode is synced across CLI and Web in real time.

## Documentation

- [fius.dev](https://fius.dev) — platform
- [fius.dev/docs](https://fius.dev/docs) — documentation
- [GitHub Issues](https://github.com/FiusDEV/Fius/issues) — bug reports & features

## License

[MIT](LICENSE) — Copyright (c) 2026 FiusDEV
