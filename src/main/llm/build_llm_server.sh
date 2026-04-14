#!/bin/bash
# Build the LLM server (notely-llm-server) as a standalone executable
# Requires: llama-cpp-python installed with GPU support (CUDA or Metal)
# This script should be run from the llm directory with an active venv
#
# Usage: ./build_llm_server.sh [arch]
#   arch: arm64 or x64 (defaults to current machine architecture)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Detect or use specified architecture
if [ -n "$1" ]; then
    ARCH="$1"
else
    MACHINE_ARCH=$(uname -m)
    if [ "$MACHINE_ARCH" = "arm64" ]; then
        ARCH="arm64"
    else
        ARCH="x64"
    fi
fi

echo "=== Building Notely LLM Server ==="
echo "Working directory: $SCRIPT_DIR"
echo "Target architecture: $ARCH"

# Activate virtual environment
if [ -d ".venv" ]; then
    echo "Activating virtual environment..."
    source .venv/bin/activate
else
    echo "ERROR: Virtual environment not found at .venv"
    echo "Please create it first: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Install PyInstaller if not present
if ! python -c "import PyInstaller" 2>/dev/null; then
    echo "Installing PyInstaller..."
    pip install pyinstaller
fi

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf build/ dist/

# Build the executable
echo "Building executable with PyInstaller..."
python -m PyInstaller \
  --onefile \
  --name notely-llm-server \
  --distpath "dist/$ARCH" \
  --clean \
  --hidden-import=backends \
  --hidden-import=backends.llamacpp_backend \
  --hidden-import=chunking_pipeline \
  --collect-all llama_cpp \
  server.py

# Check if build succeeded
if [ -f "dist/$ARCH/notely-llm-server" ]; then
    echo ""
    echo "=== Build Successful ==="
    echo "Executable: $SCRIPT_DIR/dist/$ARCH/notely-llm-server"
    ls -lh "dist/$ARCH/notely-llm-server"
else
    echo "ERROR: Build failed - executable not found"
    exit 1
fi
