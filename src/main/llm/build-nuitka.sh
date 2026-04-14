#!/usr/bin/env bash
#
# Build the LLM server as a standalone binary using Nuitka.
# Output: dist/notely-llm-server (or .exe on Windows)
#
# Prerequisites:
#   pip install nuitka ordered-set zstandard
#
# Usage:
#   cd src/main/llm
#   bash build-nuitka.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate venv if present
if [ -f ".venv/bin/activate" ]; then
  source .venv/bin/activate
elif [ -f ".venv/Scripts/activate" ]; then
  source .venv/Scripts/activate
fi

# Ensure Nuitka is installed
python -m pip install --quiet nuitka ordered-set zstandard

# Create output directory
mkdir -p dist

echo "=== Building LLM server with Nuitka ==="
echo "Entry point: server.py"
echo "Output dir: dist/"

python -m nuitka \
  --standalone \
  --onefile \
  --output-filename=notely-llm-server \
  --output-dir=dist \
  --include-module=backends \
  --include-module=chunking_pipeline \
  --include-data-files=backends/*.py=backends/ \
  --include-data-files=chunking_pipeline.py=./ \
  --follow-imports \
  --assume-yes-for-downloads \
  --remove-output \
  server.py

echo "=== Build complete ==="
echo "Output: dist/notely-llm-server"
ls -lh dist/notely-llm-server* 2>/dev/null || echo "Note: Check dist/ for output file"
