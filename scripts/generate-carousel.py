#!/usr/bin/env python3
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "mcp-servers/linkedin-carousel-generator/src"))

from linkedin_carousel import CarouselGenerator


def main():
    parser = argparse.ArgumentParser(
        description="Generate LinkedIn carousel PDFs from newsletter markdown files"
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Newsletter file or directory"
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Process all .md files in directory"
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Preview slide content without generating images (no API calls)"
    )
    parser.add_argument(
        "--model",
        choices=["gemini", "gpt-image-1.5"],
        help="Force specific AI model (overrides default)"
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Custom output directory"
    )

    args = parser.parse_args()

    if not args.input.exists():
        print(f"✗ Error: {args.input} does not exist")
        sys.exit(1)

    generator = CarouselGenerator(output_dir=args.output)

    if args.preview:
        if args.input.is_dir():
            print("✗ Error: Preview mode only works with single files")
            sys.exit(1)

        slides = generator.preview_slides(args.input)
        if slides:
            print(f"\n✓ Preview complete ({len(slides)} slides)")
        else:
            print("\n✗ Preview failed")
            sys.exit(1)

    elif args.batch:
        if not args.input.is_dir():
            print("✗ Error: Batch mode requires a directory")
            sys.exit(1)

        results = generator.generate_batch(args.input)
        successful = sum(1 for r in results if r["success"])

        if successful == 0:
            print("\n✗ All carousels failed")
            sys.exit(1)
        elif successful < len(results):
            print(f"\n⚠ Partial success: {successful}/{len(results)}")
            sys.exit(0)
        else:
            print(f"\n✓ All {successful} carousels generated successfully")
            sys.exit(0)

    else:
        if args.input.is_dir():
            print("✗ Error: Use --batch flag to process directories")
            sys.exit(1)

        pdf_path = generator.generate_carousel(args.input, force_model=args.model)

        if pdf_path:
            print(f"\n✓ Success: {pdf_path}")
            sys.exit(0)
        else:
            print("\n✗ Failed to generate carousel")
            sys.exit(1)


if __name__ == "__main__":
    main()
