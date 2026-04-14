# Build the LLM server (notely-llm-server) as a standalone executable for Windows
# Requires: llama-cpp-python installed with CUDA support (pre-built wheel)
# Usage: .\build_llm_server.ps1 [-Arch x64]

param(
    [string]$Arch = "x64"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "=== Building Notely LLM Server ===" -ForegroundColor Cyan
Write-Host "Working directory: $ScriptDir"
Write-Host "Target architecture: $Arch"

# Check for virtual environment
if (Test-Path ".venv") {
    Write-Host "Activating virtual environment..."
    & ".\.venv\Scripts\Activate.ps1"
} else {
    Write-Host "ERROR: Virtual environment not found at .venv" -ForegroundColor Red
    Write-Host "Please create it first:"
    Write-Host "  python -m venv .venv"
    Write-Host "  .\.venv\Scripts\Activate.ps1"
    Write-Host "  pip install -r requirements.txt"
    exit 1
}

# Install PyInstaller if not present
try {
    python -c "import PyInstaller" 2>$null
} catch {
    Write-Host "Installing PyInstaller..."
    pip install pyinstaller
}

# Clean previous builds
Write-Host "Cleaning previous builds..."
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue build, dist

# Build the executable
Write-Host "Building executable with PyInstaller..."
python -m PyInstaller `
  --onefile `
  --name notely-llm-server `
  --distpath "dist\$Arch" `
  --clean `
  --hidden-import=backends `
  --hidden-import=backends.llamacpp_backend `
  --hidden-import=chunking_pipeline `
  --collect-all llama_cpp `
  server.py

# Check if build succeeded
$BinaryPath = "dist\$Arch\notely-llm-server.exe"
if (Test-Path $BinaryPath) {
    Write-Host ""
    Write-Host "=== Build Successful ===" -ForegroundColor Green
    Write-Host "Executable: $ScriptDir\$BinaryPath"
    Get-Item $BinaryPath | Select-Object Name, Length
} else {
    Write-Host "ERROR: Build failed - executable not found" -ForegroundColor Red
    exit 1
}
