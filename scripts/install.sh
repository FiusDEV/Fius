#!/usr/bin/env bash
set -euo pipefail

# Fius CLI Installer
# Usage: curl -fsSL https://fius.dev/install | bash

FIUS_VERSION="${FIUS_VERSION:-}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
FORCE="${FORCE:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() {
    echo -e "${CYAN}▸${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✖${NC} $1" >&2
    exit 1
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect OS
detect_os() {
    local os
    case "$(uname -s)" in
        Linux*)     os="linux" ;;
        Darwin*)    os="darwin" ;;
        CYGWIN*|MINGW*|MSYS*) os="windows" ;;
        *)          os="unknown" ;;
    esac
    echo "$os"
}

# Detect architecture
detect_arch() {
    local arch
    case "$(uname -m)" in
        x86_64|amd64)   arch="x64" ;;
        arm64|aarch64)   arch="arm64" ;;
        armv7l|armhf)    arch="armv7" ;;
        *)               arch="unknown" ;;
    esac
    echo "$arch"
}

# Check Node.js installation
check_node() {
    if command_exists node; then
        local node_version
        node_version=$(node -v | sed 's/v//')
        local major
        major=$(echo "$node_version" | cut -d. -f1)
        if [ "$major" -ge 20 ]; then
            success "Node.js v${node_version} found"
            return 0
        else
            warn "Node.js v${node_version} found, but v20+ is required"
            return 1
        fi
    else
        return 1
    fi
}

# Install Node.js if not present
install_node() {
    info "Installing Node.js..."
    
    local os
    os=$(detect_os)
    
    if [ "$os" = "darwin" ]; then
        if command_exists brew; then
            brew install node
        elif command_exists fnm; then
            fnm install --lts
            fnm use lts-latest
        elif command_exists nvm; then
            nvm install --lts
            nvm use --lts
        else
            error "Please install Node.js v20+ manually: https://nodejs.org"
        fi
    elif [ "$os" = "linux" ]; then
        if command_exists apt-get; then
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command_exists yum; then
            curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
            sudo yum install -y nodejs
        elif command_exists pacman; then
            sudo pacman -S nodejs npm
        elif command_exists brew; then
            brew install node
        elif command_exists fnm; then
            fnm install --lts
            fnm use lts-latest
        elif command_exists nvm; then
            nvm install --lts
            nvm use --lts
        else
            error "Please install Node.js v20+ manually: https://nodejs.org"
        fi
    else
        error "Please install Node.js v20+ manually: https://nodejs.org"
    fi
    
    if ! check_node; then
        error "Node.js installation failed. Please install manually: https://nodejs.org"
    fi
}

# Install Fius via npm
install_fius_npm() {
    local version_flag=""
    if [ -n "$FIUS_VERSION" ]; then
        version_flag="@${FIUS_VERSION}"
    fi
    
    info "Installing Fius CLI via npm..."
    npm install -g "@fiusdev/fius${version_flag}"
    success "Fius CLI installed successfully"
}

# Create symlink for local installation
create_symlink() {
    local target="$1"
    local link="$2"
    
    mkdir -p "$(dirname "$link")"
    ln -sf "$target" "$link"
    success "Created symlink: $link -> $target"
}

# Main installation
main() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       Fius CLI Installer             ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
    echo ""
    
    # Check Node.js
    if ! check_node; then
        install_node
    fi
    
    # Install Fius
    install_fius_npm
    
    # Verify installation
    if command_exists fius; then
        echo ""
        success "Installation complete!"
        echo ""
        echo -e "  Run ${CYAN}fius --help${NC} to get started"
        echo -e "  Run ${CYAN}fius${NC} to launch interactive mode"
        echo ""
    else
        warn "Fius installed but not found in PATH"
        echo ""
        echo -e "  Add to your PATH:"
        echo -e "    ${CYAN}export PATH=\"\$HOME/.npm-global/bin:\$PATH\"${NC}"
        echo ""
        echo -e "  Or run directly:"
        echo -e "    ${CYAN}npx fius${NC}"
        echo ""
    fi
}

main "$@"
