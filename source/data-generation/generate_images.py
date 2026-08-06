"""
Step 3: Generate product images using Amazon Nova Canvas on Bedrock.

Takes image-prompts.json and generates images for each product,
saving them to the images/ directory.

Usage:
    python generate_images.py [--input image-prompts.json] [--output-dir images]
    python generate_images.py --limit 10  # Generate only first 10 products (for testing)
    python generate_images.py --resume    # Skip already-generated images
    python generate_images.py --shots lifestyle  # Only generate lifestyle shots
"""

import argparse
import base64
import json
import os
import time
from pathlib import Path

import boto3

from config import BEDROCK_CONFIG, IMAGE_CONFIG, PHOTOGRAPHY_STYLE

bedrock = boto3.client(
    "bedrock-runtime",
    region_name=BEDROCK_CONFIG["region"],
)

NEGATIVE_PROMPT = ", ".join(PHOTOGRAPHY_STYLE["avoid"]) + ", low quality, blurry, distorted, deformed"


def generate_image(prompt: str, shot_type: str, output_path: Path) -> bool:
    """Generate a single image using Nova Canvas."""

    config = IMAGE_CONFIG[shot_type]

    body = json.dumps({
        "taskType": "TEXT_IMAGE",
        "textToImageParams": {
            "text": prompt,
            "negativeText": NEGATIVE_PROMPT,
        },
        "imageGenerationConfig": {
            "width": config["width"],
            "height": config["height"],
            "numberOfImages": 1,
            "quality": "premium",
            "cfgScale": 7.0,
            "seed": 0,  # 0 = random
        },
    })

    try:
        response = bedrock.invoke_model(
            modelId=BEDROCK_CONFIG["image_model_id"],
            body=body,
            contentType="application/json",
            accept="application/json",
        )

        response_body = json.loads(response["body"].read())

        if "images" in response_body and response_body["images"]:
            image_data = base64.b64decode(response_body["images"][0])
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(image_data)
            return True
        else:
            print(f"      No image in response: {response_body.get('error', 'unknown')}")
            return False

    except Exception as e:
        print(f"      Error: {e}")
        return False


def generate_all_images(
    prompts: dict,
    output_dir: Path,
    limit: int | None = None,
    resume: bool = False,
    shots: list[str] | None = None,
    manifest_base: Path | None = None,
) -> dict:
    """Generate images for all products.

    Args:
        manifest_base: Paths recorded in the returned manifest are made relative
            to this directory. Keeping them relative means the manifest is
            portable and does not leak the generating machine's filesystem
            layout when committed to the repository.
    """

    shot_types = shots or ["lifestyle", "studio"]
    product_ids = list(prompts.keys())

    if limit:
        product_ids = product_ids[:limit]

    total_images = len(product_ids) * len(shot_types)
    generated = 0
    skipped = 0
    failed = 0

    print(f"  Total images to generate: {total_images}")
    print(f"  Shot types: {shot_types}")
    print()

    results = {}

    for i, product_id in enumerate(product_ids, 1):
        product_prompts = prompts[product_id]
        results[product_id] = {}

        for shot_type in shot_types:
            if shot_type not in product_prompts:
                print(f"  [{i}/{len(product_ids)}] {product_id} - {shot_type}: no prompt, skipping")
                continue

            filename = f"{product_id.lower()}-{shot_type}.png"
            output_path = output_dir / filename
            # Record a repo-relative path in the manifest, never an absolute one.
            recorded_path = (
                os.path.relpath(output_path, manifest_base)
                if manifest_base
                else str(output_path)
            )

            # Resume mode: skip existing files
            if resume and output_path.exists():
                skipped += 1
                results[product_id][shot_type] = recorded_path
                continue

            prompt = product_prompts[shot_type]
            print(f"  [{i}/{len(product_ids)}] {product_id} - {shot_type}...", end=" ")

            success = generate_image(prompt, shot_type, output_path)

            if success:
                generated += 1
                results[product_id][shot_type] = recorded_path
                print("✓")
            else:
                failed += 1
                print("✗")
                # Retry once after a delay
                time.sleep(3)
                print(f"    Retrying...", end=" ")
                success = generate_image(prompt, shot_type, output_path)
                if success:
                    generated += 1
                    failed -= 1
                    results[product_id][shot_type] = recorded_path
                    print("✓")
                else:
                    print("✗ (giving up)")

            # Rate limiting: Nova Canvas has throttling limits
            time.sleep(2)

        # Brief pause between products
        if i % 10 == 0:
            print(f"\n  --- Progress: {i}/{len(product_ids)} products, "
                  f"{generated} generated, {skipped} skipped, {failed} failed ---\n")

    return {
        "results": results,
        "stats": {
            "total_attempted": total_images,
            "generated": generated,
            "skipped": skipped,
            "failed": failed,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Generate product images")
    parser.add_argument("--input", type=str, default="image-prompts.json",
                        help="Input prompts file")
    parser.add_argument("--output-dir", type=str, default="images",
                        help="Output directory for images")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit number of products (for testing)")
    parser.add_argument("--resume", action="store_true",
                        help="Skip already-generated images")
    parser.add_argument("--shots", type=str, nargs="+",
                        choices=["lifestyle", "studio", "detail"],
                        help="Which shot types to generate")
    args = parser.parse_args()

    base_dir = Path(__file__).parent
    input_path = base_dir / args.input
    output_dir = base_dir / args.output_dir

    # Load prompts
    with open(input_path) as f:
        prompts = json.load(f)

    product_count = len(prompts)
    if args.limit:
        product_count = min(args.limit, product_count)

    print(f"🖼️  Generating images with Amazon Nova Canvas")
    print(f"   Input: {input_path} ({len(prompts)} products)")
    print(f"   Output: {output_dir}/")
    print(f"   Products to process: {product_count}")
    print(f"   Resume mode: {args.resume}")
    print()

    output_dir.mkdir(parents=True, exist_ok=True)

    result = generate_all_images(
        prompts=prompts,
        output_dir=output_dir,
        limit=args.limit,
        resume=args.resume,
        shots=args.shots,
        manifest_base=base_dir,
    )

    stats = result["stats"]
    print(f"\n{'='*60}")
    print(f"Results")
    print(f"{'='*60}")
    print(f"  Generated: {stats['generated']}")
    print(f"  Skipped (existing): {stats['skipped']}")
    print(f"  Failed: {stats['failed']}")
    print(f"  Total: {stats['generated'] + stats['skipped']}/{stats['total_attempted']}")

    # Save results manifest
    manifest_path = base_dir / "image-manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\n✓ Manifest saved to {manifest_path}")


if __name__ == "__main__":
    main()
