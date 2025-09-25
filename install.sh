#!/bin/bash

set -e

# Configuration
REPO_OWNER=${REPO_OWNER:-"mister-teddy"}  # Set this to your GitHub username
REPO_NAME=${REPO_NAME:-"node-drive"}  # Or set via environment variable
BINARY_NAME="mini-server"
INSTALL_DIR="/opt/mini-server"
SERVICE_NAME="mini-server"

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
if [[ $EUID -eq 0 ]]; then
   log_error "This script should not be run as root for security reasons"
   exit 1
fi

# Validate required variables
if [[ -z "$REPO_OWNER" ]]; then
    log_error "REPO_OWNER environment variable must be set"
    log_info "Example: export REPO_OWNER=yourusername"
    exit 1
fi

log_info "Installing ${BINARY_NAME} from ${REPO_OWNER}/${REPO_NAME}"

# Detect architecture
ARCH=$(uname -m)
if [[ "$ARCH" != "x86_64" ]]; then
    log_error "Unsupported architecture: $ARCH. Only x86_64 is supported."
    exit 1
fi

# Get latest release
log_info "Fetching latest release information..."
RELEASE_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
DOWNLOAD_URL=$(curl -s "$RELEASE_URL" | grep "browser_download_url.*linux-x86_64.tar.gz" | cut -d '"' -f 4)

if [[ -z "$DOWNLOAD_URL" ]]; then
    log_error "Could not find download URL for linux-x86_64 binary"
    log_info "Make sure the repository has releases with linux-x86_64 binaries"
    exit 1
fi

log_info "Found download URL: $DOWNLOAD_URL"

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download and extract
log_info "Downloading binary..."
cd "$TEMP_DIR"
curl -L -o "${BINARY_NAME}-linux-x86_64.tar.gz" "$DOWNLOAD_URL"

log_info "Extracting binary..."
tar -xzf "${BINARY_NAME}-linux-x86_64.tar.gz"

# Create install directory
log_info "Creating install directory..."
sudo mkdir -p "$INSTALL_DIR"

# Install binary
log_info "Installing binary to $INSTALL_DIR..."
sudo cp "$BINARY_NAME" "$INSTALL_DIR/"
sudo chmod +x "$INSTALL_DIR/$BINARY_NAME"

# Create systemd service (optional, for production deployments)
log_info "Creating systemd service..."
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=Mini Server
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/$BINARY_NAME
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security settings for f1-micro VM
MemoryLimit=256M
CPUQuota=50%

# Environment variables (customize as needed)
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}

log_info "Installation complete!"
log_info "Binary installed to: $INSTALL_DIR/$BINARY_NAME"
log_info "Service created: $SERVICE_NAME"
log_info ""
log_info "To start the service:"
log_info "  sudo systemctl start $SERVICE_NAME"
log_info ""
log_info "To check service status:"
log_info "  sudo systemctl status $SERVICE_NAME"
log_info ""
log_info "To view logs:"
log_info "  sudo journalctl -u $SERVICE_NAME -f"
log_info ""
log_info "To run manually (for testing):"
log_info "  cd $INSTALL_DIR && ./$BINARY_NAME"
