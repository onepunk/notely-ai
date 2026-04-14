# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for Notely Audio Engine (Transcription Server)

This creates a standalone executable that includes:
- FastAPI/Uvicorn server
- faster-whisper inference engine
- CTranslate2 runtime
- All required dependencies

The model files are NOT bundled here - they are included separately
via electron-builder's extraResources.
"""

import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect all submodules for packages that have hidden imports
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.protocols.websockets.wsproto_impl',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'faster_whisper',
    'ctranslate2',
    'huggingface_hub',
    'tokenizers',
    'soundfile',
    'numpy',
    'scipy',
    'scipy.signal',
    # onnxruntime — required by faster-whisper's internal VAD (silero_vad_v6.onnx)
    'onnxruntime',
    'onnxruntime.capi',
    'onnxruntime.capi._pybind_state',
    # WebSocket support — required for uvicorn WebSocket protocol
    'websockets',
    'websockets.legacy',
    'websockets.legacy.server',
    'websockets.server',
    'starlette.websockets',
    # Local modules used by server_v3.py
    'backends',
    'backends.base',
    'backends.factory',
    'backends.faster_whisper',
    'backends.mlx_whisper',
    'backends.exceptions',
    'sliding_window',
    'vad',
    'hallucination_filter',
    'refinement',
]

# Add all ctranslate2 submodules
hiddenimports += collect_submodules('ctranslate2')
hiddenimports += collect_submodules('faster_whisper')
hiddenimports += collect_submodules('websockets')
hiddenimports += collect_submodules('onnxruntime')

# Collect data files needed by packages
datas = []
datas += collect_data_files('faster_whisper')
datas += collect_data_files('ctranslate2')
datas += [('data/hallucination_blocklist.json', 'data')]

a = Analysis(
    ['server_v3.py', 'utils.py', 'sliding_window.py', 'vad.py', 'hallucination_filter.py', 'refinement.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'PIL',
        'cv2',
        'torch',        # We use ctranslate2, not torch for inference
        'torchaudio',   # Not used — its hook drags in all torch DLLs (~1.5GB)
        # NOTE: onnxruntime MUST be included — faster-whisper's internal VAD
        # (faster_whisper/vad.py) loads silero_vad_v6.onnx via onnxruntime.
        # Excluding it causes silent transcription failure in packaged builds.
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='audio-engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
