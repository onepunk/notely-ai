#!/usr/bin/env python3
"""
Calculate Word Error Rate (WER) for transcription accuracy.

Usage:
    python calculate-wer.py --reference ref.txt --hypothesis hyp.txt
    python calculate-wer.py -r ref.txt -h result.json --output wer.json
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional


def normalize_text(text: str) -> str:
    """Normalize text for WER calculation."""
    # Convert to lowercase
    text = text.lower()
    # Remove punctuation except apostrophes in contractions
    text = re.sub(r"[^\w\s']", " ", text)
    # Normalize whitespace
    text = " ".join(text.split())
    return text


def levenshtein_distance(ref: list, hyp: list) -> tuple[int, int, int, int]:
    """
    Calculate Levenshtein distance with operation counts.

    Returns:
        tuple: (distance, substitutions, insertions, deletions)
    """
    m, n = len(ref), len(hyp)

    # dp[i][j] = (distance, subs, ins, dels)
    dp = [[(0, 0, 0, 0) for _ in range(n + 1)] for _ in range(m + 1)]

    # Initialize base cases
    for i in range(m + 1):
        dp[i][0] = (i, 0, 0, i)  # All deletions
    for j in range(n + 1):
        dp[0][j] = (j, 0, j, 0)  # All insertions

    # Fill DP table
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if ref[i - 1] == hyp[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                # Substitution
                sub = dp[i - 1][j - 1]
                sub_cost = (sub[0] + 1, sub[1] + 1, sub[2], sub[3])

                # Insertion
                ins = dp[i][j - 1]
                ins_cost = (ins[0] + 1, ins[1], ins[2] + 1, ins[3])

                # Deletion
                dele = dp[i - 1][j]
                del_cost = (dele[0] + 1, dele[1], dele[2], dele[3] + 1)

                # Choose minimum
                dp[i][j] = min(sub_cost, ins_cost, del_cost, key=lambda x: x[0])

    return dp[m][n]


def calculate_wer(reference: str, hypothesis: str) -> dict:
    """
    Calculate Word Error Rate between reference and hypothesis.

    WER = (S + D + I) / N
    where:
        S = substitutions
        D = deletions
        I = insertions
        N = words in reference
    """
    # Normalize texts
    ref_normalized = normalize_text(reference)
    hyp_normalized = normalize_text(hypothesis)

    ref_words = ref_normalized.split()
    hyp_words = hyp_normalized.split()

    if not ref_words:
        return {
            "wer": 0.0 if not hyp_words else 1.0,
            "wer_percent": 0.0 if not hyp_words else 100.0,
            "reference_words": 0,
            "hypothesis_words": len(hyp_words),
            "substitutions": 0,
            "insertions": len(hyp_words),
            "deletions": 0,
            "edit_distance": len(hyp_words),
        }

    distance, subs, ins, dels = levenshtein_distance(ref_words, hyp_words)
    wer = distance / len(ref_words)

    return {
        "wer": round(wer, 4),
        "wer_percent": round(wer * 100, 2),
        "reference_words": len(ref_words),
        "hypothesis_words": len(hyp_words),
        "substitutions": subs,
        "insertions": ins,
        "deletions": dels,
        "edit_distance": distance,
    }


def load_hypothesis(path: Path) -> str:
    """Load hypothesis from text or JSON file."""
    content = path.read_text(encoding="utf-8").strip()

    # Try to parse as JSON (output from CLI)
    try:
        data = json.loads(content)
        if isinstance(data, dict):
            # Check common keys from CLI output
            if "text" in data:
                return data["text"]
            elif "transcription" in data:
                return data["transcription"]
        return content
    except json.JSONDecodeError:
        return content


def main():
    parser = argparse.ArgumentParser(
        description="Calculate Word Error Rate (WER)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Compare text files
    python calculate-wer.py -r reference.txt -h hypothesis.txt

    # Compare with CLI output (JSON)
    python calculate-wer.py -r reference.txt -h result.json

    # Save detailed results
    python calculate-wer.py -r reference.txt -h result.json -o wer_report.json

    # Inline comparison
    python calculate-wer.py --ref-text "hello world" --hyp-text "helo word"
"""
    )

    # Input options
    input_group = parser.add_argument_group("input")
    input_group.add_argument(
        "--reference", "-r",
        help="Reference text file (ground truth)"
    )
    input_group.add_argument(
        "--hypothesis", "-y",
        help="Hypothesis text file or JSON from CLI"
    )
    input_group.add_argument(
        "--ref-text",
        help="Reference text string (alternative to --reference)"
    )
    input_group.add_argument(
        "--hyp-text",
        help="Hypothesis text string (alternative to --hypothesis)"
    )

    # Output options
    output_group = parser.add_argument_group("output")
    output_group.add_argument(
        "--output", "-o",
        help="Output JSON file for detailed results"
    )
    output_group.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON to stdout"
    )
    output_group.add_argument(
        "--threshold",
        type=float,
        help="Exit with error if WER exceeds threshold (e.g., 0.15 for 15%%)"
    )

    args = parser.parse_args()

    # Get reference text
    if args.ref_text:
        reference = args.ref_text
    elif args.reference:
        ref_path = Path(args.reference)
        if not ref_path.exists():
            print(f"Error: Reference file not found: {args.reference}", file=sys.stderr)
            sys.exit(1)
        reference = ref_path.read_text(encoding="utf-8").strip()
    else:
        print("Error: Must provide --reference or --ref-text", file=sys.stderr)
        sys.exit(1)

    # Get hypothesis text
    if args.hyp_text:
        hypothesis = args.hyp_text
    elif args.hypothesis:
        hyp_path = Path(args.hypothesis)
        if not hyp_path.exists():
            print(f"Error: Hypothesis file not found: {args.hypothesis}", file=sys.stderr)
            sys.exit(1)
        hypothesis = load_hypothesis(hyp_path)
    else:
        print("Error: Must provide --hypothesis or --hyp-text", file=sys.stderr)
        sys.exit(1)

    # Calculate WER
    result = calculate_wer(reference, hypothesis)

    # Output results
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"WER: {result['wer_percent']:.2f}%")
        print(f"Reference words: {result['reference_words']}")
        print(f"Hypothesis words: {result['hypothesis_words']}")
        print(f"Edit distance: {result['edit_distance']}")
        print(f"  Substitutions: {result['substitutions']}")
        print(f"  Insertions: {result['insertions']}")
        print(f"  Deletions: {result['deletions']}")

    # Save to file if requested
    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2))
        if not args.json:
            print(f"\nResults saved to: {args.output}")

    # Check threshold
    if args.threshold is not None:
        if result["wer"] > args.threshold:
            print(f"\nFAIL: WER {result['wer_percent']:.2f}% exceeds threshold {args.threshold * 100:.1f}%", file=sys.stderr)
            sys.exit(1)
        else:
            print(f"\nPASS: WER {result['wer_percent']:.2f}% is within threshold {args.threshold * 100:.1f}%")


if __name__ == "__main__":
    main()
