#!/bin/bash

set -e

# Configuration
REPO_OWNER="mister-teddy"
REPO_NAME="node-drive"
BINARY_NAME="node-drive"
INSTALL_DIR="/opt/node-drive"
SERVICE_NAME="node-drive"

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

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
       log_error "This script should not be run as root for security reasons"
       exit 1
    fi
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

    if ! command -v openssl >/dev/null 2>&1; then
        missing+=("openssl")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        log_info "Please install the missing tools and try again"
        exit 1
    fi
}

# Create install directory
create_install_dir() {
    log_info "Creating install directory..."
    sudo mkdir -p "$INSTALL_DIR"
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
    log_info "Installing node-drive from ${REPO_OWNER}/${REPO_NAME}"

    # Check if running as root
    check_root

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
    sudo cp "$binary_path" "$INSTALL_DIR/$BINARY_NAME"
    sudo chmod +x "$INSTALL_DIR/$BINARY_NAME"

    # Install assets directory if it exists in the archive
    if [[ -d "assets" ]]; then
        log_info "Installing assets to $INSTALL_DIR..."
        sudo cp -r assets "$INSTALL_DIR/"
    fi

    # Ensure node-drive directory exists first
    log_info "Ensuring node-drive directory exists..."
    local node_drive_dir="$HOME/node-drive"
    if [[ ! -d "$node_drive_dir" ]]; then
        mkdir -p "$node_drive_dir"
        log_info "Created $node_drive_dir directory"
    fi

    # Generate self-signed TLS certificates if they don't exist
    local cert_dir="$INSTALL_DIR/certs"
    local cert_file="$cert_dir/cert.pem"
    local key_file="$cert_dir/key.pem"

    if [[ ! -f "$cert_file" ]] || [[ ! -f "$key_file" ]]; then
        log_info "Generating self-signed TLS certificates..."
        sudo mkdir -p "$cert_dir"

        # Get external IP for certificate
        local external_ip
        external_ip=$(curl -4 -s ifconfig.me 2>/dev/null || curl -4 -s ipinfo.io/ip 2>/dev/null || echo "localhost")

        # Generate self-signed certificate valid for 365 days
        sudo openssl req -x509 -newkey rsa:4096 -nodes \
            -keyout "$key_file" \
            -out "$cert_file" \
            -days 365 \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=$external_ip" \
            -addext "subjectAltName=IP:$external_ip,DNS:localhost" \
            2>/dev/null

        # Set proper ownership and permissions for the service user to read
        sudo chown root:root "$key_file" "$cert_file"
        sudo chmod 644 "$key_file"
        sudo chmod 644 "$cert_file"

        log_info "Generated self-signed certificates at $cert_dir"
        log_warn "Self-signed certificates will show security warnings in browsers"
        log_info "For production, consider using Let's Encrypt certificates"
    else
        log_info "TLS certificates already exist at $cert_dir"
    fi

    # Create systemd service for HTTPS (primary service)
    log_info "Creating systemd service for HTTPS..."
    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=Node Drive File Server with Provenance (HTTPS)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$node_drive_dir
ExecStart=$INSTALL_DIR/$BINARY_NAME --bind 0.0.0.0 --port 443 --tls-cert $cert_file --tls-key $key_file $node_drive_dir
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security settings
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=no
ReadWritePaths=$node_drive_dir
ReadOnlyPaths=$cert_dir
PrivateTmp=yes
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Environment variables
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

    # Create systemd service for HTTP (redirect service)
    log_info "Creating systemd service for HTTP redirect..."
    sudo tee /etc/systemd/system/${SERVICE_NAME}-http.service > /dev/null <<EOF
[Unit]
Description=Node Drive File Server with Provenance (HTTP Redirect)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$node_drive_dir
ExecStart=$INSTALL_DIR/$BINARY_NAME --bind 0.0.0.0 --port 80 $node_drive_dir
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security settings
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=no
ReadWritePaths=$node_drive_dir
PrivateTmp=yes
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Environment variables
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd and enable both services
    sudo systemctl daemon-reload
    sudo systemctl enable ${SERVICE_NAME}
    sudo systemctl enable ${SERVICE_NAME}-http

    # Verify installation
    if "$INSTALL_DIR/$BINARY_NAME" --version >/dev/null 2>&1; then
        log_info "Installation complete!"
        log_info "Binary installed to: $INSTALL_DIR/$BINARY_NAME"
        log_info "Services created: $SERVICE_NAME (HTTPS) and ${SERVICE_NAME}-http (HTTP)"
        log_info ""
        log_info "To start both services:"
        log_info "  sudo systemctl start $SERVICE_NAME"
        log_info "  sudo systemctl start ${SERVICE_NAME}-http"
        log_info ""
        log_info "To check service status:"
        log_info "  sudo systemctl status $SERVICE_NAME"
        log_info "  sudo systemctl status ${SERVICE_NAME}-http"
        log_info ""
        log_info "To view logs:"
        log_info "  sudo journalctl -u $SERVICE_NAME -f"
        log_info "  sudo journalctl -u ${SERVICE_NAME}-http -f"
        log_info ""
        log_info "To run manually (for testing):"
        log_info "  cd $INSTALL_DIR && ./$BINARY_NAME"
        log_info ""
        # Get external IP address
        local external_ip
        external_ip=$(curl -4 -s ifconfig.me 2>/dev/null || curl -4 -s ipinfo.io/ip 2>/dev/null || echo "34.42.164.242")

        log_info "Default configuration serves ~/node-drive on ports 80 (HTTP) and 443 (HTTPS)"
        log_info "Web interface available at:"
        log_info "  HTTP:  http://$external_ip"
        log_info "  HTTPS: https://$external_ip"
        log_info ""
        log_warn "Note: HTTPS uses self-signed certificates. Browsers will show security warnings."
        log_info "For provenance features (file hashing), use HTTPS to enable crypto.subtle API."
    else
        log_error "Installation verification failed"
        exit 1
    fi
}

main "$@"
