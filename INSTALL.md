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
npm install -g fius
```

### Homebrew (macOS/Linux)
```bash
# Add the tap
brew tap fiusdev/fius

# Install Fius
brew install fius
```

### AUR (Arch Linux)
```bash
# Using paru
paru -S fius

# Using yay
yay -S fius
```

### pnpm
```bash
pnpm add -g fius
```

### yarn
```bash
yarn global add fius
```

## Manual Installation

### Download Binary
Download the latest release from [GitHub Releases](https://github.com/fiusdev/fius/releases) and add to your PATH.

### From Source
```bash
git clone https://github.com/fiusdev/fius.git
cd fius
pnpm install
pnpm build
pnpm link:cli
```

## Verifying Installation

```bash
fius --version
```

## Getting Started

```bash
# Login to your account
fius login

# Start using Fius
fius
```

## Requirements

- Node.js v20 or later
- npm v8.3 or later (comes with Node.js)

## Troubleshooting

### Command not found
If `fius` is not found after installation, add npm's global bin directory to your PATH:

```bash
# Find npm global bin directory
npm config get prefix

# Add to PATH (add to ~/.bashrc or ~/.zshrc)
export PATH="$(npm config get prefix)/bin:$PATH"
```

### Permission errors
If you get permission errors:

```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH

# Then reinstall
npm install -g fius
```

### Windows Installation
On Windows, use PowerShell:

```powershell
# Install via npm
npm install -g fius

# Or download from GitHub Releases
# https://github.com/fiusdev/fius/releases
```
