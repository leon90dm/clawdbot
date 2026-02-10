#!/bin/bash
set -e

# Ensure we are in the project root
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "Checking prerequisites..."
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed."
    exit 1
fi

echo "Installing project dependencies..."
pnpm install

echo "Building project..."
pnpm build
pnpm ui:build

echo "Installing CLI globally..."
# Try to install globally without sudo first (for nvm/fnm users)
if npm install -g .; then
    echo "Successfully installed globally."
else
    echo "Installation failed (permission denied?). Retrying with sudo..."
    sudo npm install -g .
fi

echo "Verifying installation..."
if command -v openclaw &> /dev/null; then
    echo "openclaw CLI installed successfully!"
    echo "Path: $(command -v openclaw)"
    # Try to get version if possible, but don't fail if it errors
    openclaw --version || true
else
    echo "Warning: openclaw command not found in PATH. You might need to restart your shell or add the global bin directory to your PATH."
fi

echo ""
echo "Note: If you are running the gateway, remember to restart it to apply changes:"
echo "  openclaw gateway restart"
