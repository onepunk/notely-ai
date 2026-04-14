#!/usr/bin/env python3
"""
Transcription CLI for E2E testing.

Uses the same pipeline as the production Electron client.

Usage:
    python cli.py transcribe --input audio.wav --output result.json
    python cli.py benchmark --input audio.wav --iterations 5
    python cli.py health
    python cli.py languages
"""

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from backends import create_backend, get_available_backends, NoCompatibleGPUError
from backends.base import TranscriptionBackend
from vad import SileroVAD

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)


def load_audio(path: str, target_sr: int = 16000) -> np.ndarray:
    """Load audio file and resample to target sample rate."""
    try:
        import soundfile as sf
    except ImportError:
        raise ImportError("soundfile required for audio loading. Install with: pip install soundfile")

    audio, sr = sf.read(path)

    # Convert to mono if stereo
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    # Resample if needed
    if sr != target_sr:
        try:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        except ImportError:
            raise ImportError("librosa required for resampling. Install with: pip install librosa")

    return audio.astype(np.float32)


def get_default_model_path() -> str:
    """Get default model name — faster-whisper resolves HuggingFace cache natively."""
    return "small.en"


def cmd_transcribe(args):
    """Transcribe audio file and output results."""
    logger.info(f"Loading audio: {args.input}")
    audio = load_audio(args.input)
    duration_s = len(audio) / 16000

    logger.info(f"Audio duration: {duration_s:.1f}s")

    # Create backend
    try:
        backend = create_backend(args.backend)
        device_info = backend.get_device_info()
        logger.info(f"Backend: {device_info.backend_type} ({device_info.device_name})")
    except NoCompatibleGPUError as e:
        logger.error(f"GPU requirement not met: {e}")
        sys.exit(1)

    # Load model
    model_path = args.model or get_default_model_path()
    logger.info(f"Loading model: {model_path}")
    backend.load_model(model_path)

    # Create VAD if enabled
    vad = None
    vad_reduction_pct = 0.0
    original_audio_len = len(audio)

    if not args.no_vad:
        try:
            vad = SileroVAD()
            logger.info("VAD enabled")
        except Exception as e:
            logger.warning(f"Failed to load VAD, continuing without: {e}")

    # Process audio
    start_time = time.time()

    if vad:
        filtered_audio, segments = vad.filter_audio(audio)
        if len(filtered_audio) > 0:
            logger.info(f"VAD: {len(audio)/16000:.1f}s -> {len(filtered_audio)/16000:.1f}s")
            vad_reduction_pct = (1 - len(filtered_audio) / len(audio)) * 100
            audio = filtered_audio
        else:
            logger.warning("VAD filtered all audio, using original")

    # Transcribe
    language = args.language if args.language != 'auto' else None
    result = backend.transcribe(
        audio=audio,
        language=language,
        beam_size=args.beam_size,
        temperature=args.temperature,
        vad_filter=False,  # We already did VAD filtering
    )

    processing_time = time.time() - start_time

    # Build output
    output = {
        "text": result.text,
        "language": result.language,
        "segments": [
            {
                "text": seg.text,
                "start": seg.start_time,
                "end": seg.end_time,
                "segmentId": seg.segment_id,
            }
            for seg in result.segments
        ],
        "duration_s": duration_s,
        "processing_time_s": processing_time,
        "rtf": processing_time / duration_s if duration_s > 0 else 0,  # Real-time factor
        "backend": {
            "type": device_info.backend_type,
            "device": device_info.device_name,
            "computeType": device_info.compute_type,
        },
        "vad_enabled": vad is not None,
    }

    if vad:
        output["vad_reduction_pct"] = vad_reduction_pct

    # Output
    output_json = json.dumps(output, indent=2)

    if args.output:
        Path(args.output).write_text(output_json)
        logger.info(f"Results written to: {args.output}")
    else:
        print(output_json)

    # Summary
    logger.info(f"Processing time: {processing_time:.2f}s (RTF: {output['rtf']:.2f})")

    # Cleanup
    backend.unload()


def cmd_benchmark(args):
    """Benchmark transcription performance."""
    logger.info(f"Benchmarking with {args.iterations} iterations")

    audio = load_audio(args.input)
    duration_s = len(audio) / 16000

    try:
        backend = create_backend(args.backend)
        device_info = backend.get_device_info()
    except NoCompatibleGPUError as e:
        logger.error(f"GPU requirement not met: {e}")
        sys.exit(1)

    model_path = args.model or get_default_model_path()
    backend.load_model(model_path)

    vad = None
    if not args.no_vad:
        try:
            vad = SileroVAD()
        except Exception as e:
            logger.warning(f"Failed to load VAD, continuing without: {e}")

    times = []
    for i in range(args.iterations):
        logger.info(f"Iteration {i + 1}/{args.iterations}")

        audio_to_process = audio
        if vad:
            audio_to_process, _ = vad.filter_audio(audio)
            if len(audio_to_process) == 0:
                audio_to_process = audio

        start = time.time()
        language = args.language if args.language != 'auto' else None
        backend.transcribe(audio=audio_to_process, language=language, vad_filter=False)
        elapsed = time.time() - start
        times.append(elapsed)

        logger.info(f"  Time: {elapsed:.2f}s")

    # Statistics
    avg_time = sum(times) / len(times)
    min_time = min(times)
    max_time = max(times)
    std_time = (sum((t - avg_time) ** 2 for t in times) / len(times)) ** 0.5

    result = {
        "audio_duration_s": duration_s,
        "iterations": args.iterations,
        "avg_time_s": avg_time,
        "min_time_s": min_time,
        "max_time_s": max_time,
        "std_time_s": std_time,
        "avg_rtf": avg_time / duration_s if duration_s > 0 else 0,
        "backend": {
            "type": device_info.backend_type,
            "device": device_info.device_name,
            "computeType": device_info.compute_type,
        },
    }

    print(json.dumps(result, indent=2))

    logger.info(f"\nBenchmark Results:")
    logger.info(f"  Audio duration: {duration_s:.1f}s")
    logger.info(f"  Avg time: {avg_time:.2f}s (+/- {std_time:.2f}s)")
    logger.info(f"  RTF: {avg_time/duration_s:.3f}" if duration_s > 0 else "  RTF: N/A")

    backend.unload()


def cmd_health(args):
    """Check backend health and system info."""
    print("=== Transcription Pipeline Health Check ===\n")

    # Check backend availability
    available = get_available_backends()

    print("Available Backends:")
    print(f"  NVIDIA (CUDA): {'Yes' if available['nvidia']['available'] else 'No'}")
    if not available['nvidia']['available']:
        print(f"    Reason: {available['nvidia']['reason']}")
    else:
        print(f"    Device: {available['nvidia']['device']}")

    print(f"  Apple Silicon: {'Yes' if available['apple']['available'] else 'No'}")
    if not available['apple']['available']:
        print(f"    Reason: {available['apple']['reason']}")
    else:
        print(f"    Device: {available['apple']['device']}")

    print()

    any_available = available['nvidia']['available'] or available['apple']['available']
    if not any_available:
        print("ERROR: No compatible GPU found!")
        print("Transcription requires NVIDIA GPU or Apple Silicon.")
        sys.exit(1)

    # Create and check backend
    try:
        backend = create_backend('auto')
        device_info = backend.get_device_info()

        print(f"Active Backend: {device_info.backend_type}")
        print(f"  Device: {device_info.device_name}")
        print(f"  Compute Type: {device_info.compute_type}")
        if device_info.total_memory_mb > 0:
            print(f"  Total Memory: {device_info.total_memory_mb / 1024:.1f} GB")

        print()

        # Check model
        model_path = get_default_model_path()
        if Path(model_path).exists():
            print(f"Model: {model_path}")
            print("  Status: Found")
        else:
            print(f"Model: {model_path}")
            print("  Status: NOT FOUND")
            print("  Run the app to download the model.")

        print()

        # Check VAD
        try:
            vad = SileroVAD()
            print("VAD: Silero-VAD")
            print("  Status: OK")
        except Exception as e:
            print(f"VAD: Error - {e}")

        print()
        print("Health: OK")

    except NoCompatibleGPUError as e:
        print(f"ERROR: {e}")
        sys.exit(1)


def cmd_languages(args):
    """List supported languages."""
    languages = [
        ('en', 'English'), ('zh', 'Chinese'), ('de', 'German'),
        ('es', 'Spanish'), ('ru', 'Russian'), ('ko', 'Korean'),
        ('fr', 'French'), ('ja', 'Japanese'), ('pt', 'Portuguese'),
        ('tr', 'Turkish'), ('pl', 'Polish'), ('ca', 'Catalan'),
        ('nl', 'Dutch'), ('ar', 'Arabic'), ('sv', 'Swedish'),
        ('it', 'Italian'), ('id', 'Indonesian'), ('hi', 'Hindi'),
        ('fi', 'Finnish'), ('vi', 'Vietnamese'), ('he', 'Hebrew'),
        ('uk', 'Ukrainian'), ('el', 'Greek'), ('ms', 'Malay'),
        ('cs', 'Czech'), ('ro', 'Romanian'), ('da', 'Danish'),
        ('hu', 'Hungarian'), ('ta', 'Tamil'), ('no', 'Norwegian'),
        ('th', 'Thai'), ('ur', 'Urdu'), ('hr', 'Croatian'),
        ('bg', 'Bulgarian'), ('lt', 'Lithuanian'), ('la', 'Latin'),
        ('mi', 'Maori'), ('ml', 'Malayalam'), ('cy', 'Welsh'),
        ('sk', 'Slovak'), ('te', 'Telugu'), ('fa', 'Persian'),
        ('lv', 'Latvian'), ('bn', 'Bengali'), ('sr', 'Serbian'),
        ('az', 'Azerbaijani'), ('sl', 'Slovenian'), ('kn', 'Kannada'),
        ('et', 'Estonian'), ('mk', 'Macedonian'), ('br', 'Breton'),
        ('eu', 'Basque'), ('is', 'Icelandic'), ('hy', 'Armenian'),
        ('ne', 'Nepali'), ('mn', 'Mongolian'), ('bs', 'Bosnian'),
        ('kk', 'Kazakh'), ('sq', 'Albanian'), ('sw', 'Swahili'),
        ('gl', 'Galician'), ('mr', 'Marathi'), ('pa', 'Punjabi'),
        ('si', 'Sinhala'), ('km', 'Khmer'), ('sn', 'Shona'),
        ('yo', 'Yoruba'), ('so', 'Somali'), ('af', 'Afrikaans'),
        ('oc', 'Occitan'), ('ka', 'Georgian'), ('be', 'Belarusian'),
        ('tg', 'Tajik'), ('sd', 'Sindhi'), ('gu', 'Gujarati'),
        ('am', 'Amharic'), ('yi', 'Yiddish'), ('lo', 'Lao'),
        ('uz', 'Uzbek'), ('fo', 'Faroese'), ('ht', 'Haitian'),
        ('ps', 'Pashto'), ('tk', 'Turkmen'), ('nn', 'Nynorsk'),
        ('mt', 'Maltese'), ('sa', 'Sanskrit'), ('lb', 'Luxembourgish'),
        ('my', 'Myanmar'), ('bo', 'Tibetan'), ('tl', 'Tagalog'),
        ('mg', 'Malagasy'), ('as', 'Assamese'), ('tt', 'Tatar'),
        ('haw', 'Hawaiian'), ('ln', 'Lingala'), ('ha', 'Hausa'),
        ('ba', 'Bashkir'), ('jw', 'Javanese'), ('su', 'Sundanese'),
    ]

    print("Supported Languages (99 total):\n")
    for i in range(0, len(languages), 4):
        row = languages[i:i+4]
        print("  " + "  ".join(f"{code:3} {name:15}" for code, name in row))


def main():
    parser = argparse.ArgumentParser(
        description='Transcription CLI for E2E testing',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python cli.py health
    python cli.py languages
    python cli.py transcribe --input audio.wav --output result.json
    python cli.py transcribe --input french.wav --language fr
    python cli.py benchmark --input audio.wav --iterations 5
"""
    )
    subparsers = parser.add_subparsers(dest='command', required=True)

    # transcribe command
    p_transcribe = subparsers.add_parser('transcribe', help='Transcribe audio file')
    p_transcribe.add_argument('--input', '-i', required=True, help='Input audio file')
    p_transcribe.add_argument('--output', '-o', help='Output JSON file')
    p_transcribe.add_argument('--model', '-m', help='Model path')
    p_transcribe.add_argument('--backend', '-b', default='auto',
                              choices=['auto', 'nvidia', 'apple'])
    p_transcribe.add_argument('--language', '-l', default='auto', help='Language code or "auto"')
    p_transcribe.add_argument('--beam-size', type=int, default=5)
    p_transcribe.add_argument('--temperature', type=float, default=0.0)
    p_transcribe.add_argument('--no-vad', action='store_true', help='Disable VAD')
    p_transcribe.set_defaults(func=cmd_transcribe)

    # benchmark command
    p_benchmark = subparsers.add_parser('benchmark', help='Benchmark performance')
    p_benchmark.add_argument('--input', '-i', required=True, help='Input audio file')
    p_benchmark.add_argument('--iterations', '-n', type=int, default=5)
    p_benchmark.add_argument('--model', '-m', help='Model path')
    p_benchmark.add_argument('--backend', '-b', default='auto')
    p_benchmark.add_argument('--language', '-l', default='auto')
    p_benchmark.add_argument('--no-vad', action='store_true')
    p_benchmark.set_defaults(func=cmd_benchmark)

    # health command
    p_health = subparsers.add_parser('health', help='Check system health')
    p_health.set_defaults(func=cmd_health)

    # languages command
    p_languages = subparsers.add_parser('languages', help='List supported languages')
    p_languages.set_defaults(func=cmd_languages)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
