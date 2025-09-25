#!/bin/bash

set -e

# Configuration
REPO_OWNER="sigoden"
REPO_NAME="dufs"
BINARY_NAME="dufs"
INSTALL_DIR="$HOME/.local/bin"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect platform and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Linux*)     os="linux" ;;
        Darwin*)    os="darwin" ;;
        CYGWIN*|MINGW*|MSYS*) os="windows" ;;
        *)          log_error "Unsupported OS: $(uname -s)"; exit 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)   arch="x86_64" ;;
        arm64|aarch64)  arch="aarch64" ;;
        armv7l)         arch="armv7" ;;
        arm*)           arch="arm" ;;
        i686|i386)      arch="i686" ;;
        *)              log_error "Unsupported architecture: $(uname -m)"; exit 1 ;;
    esac

    # Construct target triple based on platform
    case "$os" in
        linux)
            case "$arch" in
                x86_64)     echo "x86_64-unknown-linux-musl" ;;
                aarch64)    echo "aarch64-unknown-linux-musl" ;;
                armv7)      echo "armv7-unknown-linux-musleabihf" ;;
                arm)        echo "arm-unknown-linux-musleabihf" ;;
                i686)       echo "i686-unknown-linux-musl" ;;
            esac
            ;;
        darwin)
            case "$arch" in
                x86_64)     echo "x86_64-apple-darwin" ;;
                aarch64)    echo "aarch64-apple-darwin" ;;
                *)          log_error "Unsupported macOS architecture: $arch"; exit 1 ;;
            esac
            ;;
        windows)
            case "$arch" in
                x86_64)     echo "x86_64-pc-windows-msvc" ;;
                aarch64)    echo "aarch64-pc-windows-msvc" ;;
                i686)       echo "i686-pc-windows-msvc" ;;
                *)          log_error "Unsupported Windows architecture: $arch"; exit 1 ;;
            esac
            ;;
    esac
}

# Check if required tools are available
check_dependencies() {
    local missing=()

    if ! command -v curl >/dev/null 2>&1; then
        missing+=("curl")
    fi

    if ! command -v tar >/dev/null 2>&1 && [[ "$(uname -s)" != CYGWIN* && "$(uname -s)" != MINGW* && "$(uname -s)" != MSYS* ]]; then
        missing+=("tar")
    fi

    if ! command -v unzip >/dev/null 2>&1 && [[ "$(uname -s)" == CYGWIN* || "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
        missing+=("unzip")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        log_info "Please install the missing tools and try again"
        exit 1
    fi
}

# Create install directory
create_install_dir() {
    if [[ ! -d "$INSTALL_DIR" ]]; then
        log_info "Creating install directory: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi
}

# Check if directory is in PATH
check_path() {
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        log_warn "Install directory $INSTALL_DIR is not in your PATH"
        log_info "Add the following line to your shell configuration file:"
        log_info "  export PATH=\"$INSTALL_DIR:\$PATH\""
        log_info ""
        log_info "For bash: ~/.bashrc or ~/.bash_profile"
        log_info "For zsh: ~/.zshrc"
        log_info "For fish: ~/.config/fish/config.fish"
    fi
}

main() {
    log_info "Installing dufs from ${REPO_OWNER}/${REPO_NAME}"

    # Check dependencies
    check_dependencies

    # Detect platform
    local target
    target=$(detect_platform)
    if [[ -z "$target" ]]; then
        log_error "Could not detect platform"
        exit 1
    fi
    log_info "Detected platform: $target"

    # Get latest release
    log_info "Fetching latest release information..."
    local release_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
    local release_data
    release_data=$(curl -s "$release_url")

    if [[ -z "$release_data" ]]; then
        log_error "Could not fetch release information"
        exit 1
    fi

    # Extract download URL based on platform
    local file_extension
    if [[ "$target" == *"windows"* ]]; then
        file_extension="zip"
    else
        file_extension="tar.gz"
    fi

    local download_url
    download_url=$(echo "$release_data" | grep -o "\"browser_download_url\":[^,]*${target}\.${file_extension}\"" | cut -d '"' -f 4)

    if [[ -z "$download_url" ]]; then
        log_error "Could not find download URL for platform: $target"
        log_info "Available releases:"
        echo "$release_data" | grep -o "\"browser_download_url\":[^,]*\.tar\.gz\"" | cut -d '"' -f 4
        echo "$release_data" | grep -o "\"browser_download_url\":[^,]*\.zip\"" | cut -d '"' -f 4
        exit 1
    fi

    log_info "Found download URL: $download_url"

    # Create temporary directory
    local temp_dir
    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    # Download and extract
    log_info "Downloading binary..."
    cd "$temp_dir"

    local filename
    filename=$(basename "$download_url")

    if ! curl -L -o "$filename" "$download_url"; then
        log_error "Failed to download binary"
        exit 1
    fi

    log_info "Extracting binary..."
    if [[ "$file_extension" == "zip" ]]; then
        unzip -q "$filename"
    else
        tar -xzf "$filename"
    fi

    # Find the binary (it might be in a subdirectory)
    local binary_path
    binary_path=$(find . -name "$BINARY_NAME" -type f | head -n1)

    if [[ -z "$binary_path" || ! -f "$binary_path" ]]; then
        log_error "Could not find binary after extraction"
        log_info "Contents of extracted archive:"
        find . -type f
        exit 1
    fi

    # Create install directory and install binary
    create_install_dir

    log_info "Installing binary to $INSTALL_DIR..."
    cp "$binary_path" "$INSTALL_DIR/$BINARY_NAME"
    chmod +x "$INSTALL_DIR/$BINARY_NAME"

    # Check PATH
    check_path

    # Verify installation
    if "$INSTALL_DIR/$BINARY_NAME" --version >/dev/null 2>&1; then
        log_info "Installation successful!"
        log_info "dufs installed to: $INSTALL_DIR/$BINARY_NAME"
        log_info ""
        log_info "Usage:"
        log_info "  dufs [OPTIONS] [serve-path]"
        log_info ""
        log_info "Examples:"
        log_info "  dufs                    # Serve current directory"
        log_info "  dufs /path/to/dir       # Serve specific directory"
        log_info "  dufs -p 8080            # Serve on port 8080"
        log_info "  dufs --help             # Show all options"
    else
        log_error "Installation verification failed"
        exit 1
    fi
}

main "$@"
