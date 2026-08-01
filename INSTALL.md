# Installing Fius CLI

## Quick Install (Recommended)

```bash
curl -fsSL https://fius.dev/install | bash
```

This will:
- Check for Node.js v20+ (install if missing)
- Install Fius CLI globally via npm

## Package Managers

### npm
```bash
npm install -g @fiusdev/fius
```

### Homebrew (macOS/Linux)
```bash
brew tap fiusdev/fius
brew install fius
```

### AUR (Arch Linux)
```bash
paru -S fius
```

### pnpm
```bash
pnpm add -g @fiusdev/fius
```

### yarn
```bash
yarn global add @fiusdev/fius
```

## Verifying Installation

```bash
fius --version
```

## Getting Started

```bash
fius
```

On first run, you'll be guided through browser-based authentication.

## Requirements

- Node.js v20 or later
- npm v8.3 or later (comes with Node.js)

## Troubleshooting

### Command not found
If `fius` is not found after installation, add npm's global bin directory to your PATH:

```bash
export PATH="$(npm config get prefix)/bin:$PATH"
```

### Permission errors
```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
npm install -g @fiusdev/fius
```
