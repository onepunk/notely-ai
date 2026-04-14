"""
Export hallucination blocklist from the HuggingFace dataset.

One-time developer script to generate the static JSON blocklist file.

Source: sachaarbonel/whisper-hallucinations (MIT license)
Dataset: https://huggingface.co/datasets/sachaarbonel/whisper-hallucinations

Usage:
    pip install datasets  # one-time, not added to requirements.txt
    python scripts/export_hallucination_blocklist.py

Output:
    data/hallucination_blocklist.json
"""

import json
import os
import sys


def export_blocklist():
    try:
        from datasets import load_dataset
    except ImportError:
        print(
            "ERROR: 'datasets' package not installed.\n"
            "Install with: pip install datasets\n"
            "This is a one-time dev dependency, not added to requirements.txt.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Loading sachaarbonel/whisper-hallucinations dataset...", file=sys.stderr)
    ds = load_dataset("sachaarbonel/whisper-hallucinations", split="train")

    # Build {language: [phrases]} dict
    blocklist: dict[str, list[str]] = {}
    skipped = 0

    for row in ds:
        lang = row.get("lang", "unknown")
        phrase = row.get("phrase", "")

        if not phrase or not lang:
            skipped += 1
            continue

        # Normalize: lowercase, strip whitespace, skip long phrases
        phrase = phrase.strip().lower()
        if len(phrase) > 64 or len(phrase) == 0:
            skipped += 1
            continue

        if lang not in blocklist:
            blocklist[lang] = []
        blocklist[lang].append(phrase)

    # Deduplicate per language
    for lang in blocklist:
        blocklist[lang] = sorted(set(blocklist[lang]))

    total_phrases = sum(len(v) for v in blocklist.values())
    total_languages = len(blocklist)

    print(f"Exported {total_phrases} phrases across {total_languages} languages", file=sys.stderr)
    print(f"Skipped {skipped} entries (empty, too long, or invalid)", file=sys.stderr)

    # Write to data directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(os.path.dirname(script_dir), "data")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "hallucination_blocklist.json")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(blocklist, f, ensure_ascii=False, indent=2)

    file_size_kb = os.path.getsize(output_path) / 1024
    print(f"Written to: {output_path} ({file_size_kb:.1f} KB)", file=sys.stderr)


if __name__ == "__main__":
    export_blocklist()
