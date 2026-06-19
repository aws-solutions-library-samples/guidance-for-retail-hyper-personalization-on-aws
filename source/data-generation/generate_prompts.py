"""
Step 2: Generate image prompts for each product in the catalog.

Takes products.json and produces image-prompts.json with 2-3 image
generation prompts per product (lifestyle, studio, and optional detail shot).

Usage:
    python generate_prompts.py [--input products.json] [--output image-prompts.json]
"""

import argparse
import json
import time
from pathlib import Path

import boto3

from config import BEDROCK_CONFIG, BRAND_NAME, PHOTOGRAPHY_STYLE

bedrock = boto3.client(
    "bedrock-runtime",
    region_name=BEDROCK_CONFIG["region"],
)


SYSTEM_PROMPT = f"""You are a creative director for {BRAND_NAME}, a premium Scandinavian furniture brand.
Your job is to write image generation prompts that will produce consistent, high-quality product photography.

Photography style guide:
- Lighting: {PHOTOGRAPHY_STYLE['lighting']}
- Color palette: {', '.join(PHOTOGRAPHY_STYLE['color_palette'])}
- Mood: {PHOTOGRAPHY_STYLE['mood']}
- Always avoid: {', '.join(PHOTOGRAPHY_STYLE['avoid'])}

Rules for prompts:
- Be specific about materials, textures, and finishes (e.g., "bouclé fabric", "brushed brass", "oiled walnut")
- Describe the lighting direction and quality
- For lifestyle shots, place the product in a realistic room context
- For studio shots, use a clean seamless background
- Keep prompts under 200 words
- Never include people in the scene
- Maintain a consistent warm, Scandinavian aesthetic across all prompts
"""


def generate_prompts_for_batch(products: list[dict]) -> dict:
    """Generate image prompts for a batch of products."""

    products_summary = json.dumps([
        {
            "ITEM_ID": p["ITEM_ID"],
            "name": p["name"],
            "category": p["category"],
            "subcategory": p["subcategory"],
            "style": p["style"],
            "material": p["material"],
            "color": p["color"],
            "dimensions": p["dimensions"],
        }
        for p in products
    ], indent=2)

    prompt = f"""Generate image prompts for these products. For each product, create exactly 2 prompts:

1. **lifestyle**: The product styled in a realistic room setting with complementary decor
2. **studio**: Clean product-only shot on a neutral background

Products:
{products_summary}

Return a JSON object where keys are ITEM_IDs and values have this structure:
{{
    "PROD-001": {{
        "lifestyle": "Professional interior photography of...",
        "studio": "Professional studio product photography of..."
    }},
    ...
}}

Make each prompt specific to the product's materials, color, style, and dimensions.
Return ONLY the JSON object, no other text."""

    response = bedrock.converse(
        modelId=BEDROCK_CONFIG["text_model_id"],
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        system=[{"text": SYSTEM_PROMPT}],
        inferenceConfig={"maxTokens": 8192, "temperature": 0.6},
    )

    response_text = response["output"]["message"]["content"][0]["text"]

    # Extract JSON
    if "```json" in response_text:
        response_text = response_text.split("```json")[1].split("```")[0]
    elif "```" in response_text:
        response_text = response_text.split("```")[1].split("```")[0]

    return json.loads(response_text.strip())


def generate_all_prompts(products: list[dict], batch_size: int = 10) -> dict:
    """Generate image prompts for all products."""

    all_prompts = {}
    total = len(products)

    for i in range(0, total, batch_size):
        batch = products[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (total + batch_size - 1) // batch_size

        print(f"  Batch {batch_num}/{total_batches}: "
              f"PROD-{batch[0]['ITEM_ID'].split('-')[1]} to PROD-{batch[-1]['ITEM_ID'].split('-')[1]}...")

        try:
            prompts = generate_prompts_for_batch(batch)
            all_prompts.update(prompts)
            print(f"    ✓ Generated prompts for {len(prompts)} products")
        except json.JSONDecodeError as e:
            print(f"    ✗ JSON parse error: {e}. Retrying...")
            time.sleep(2)
            try:
                prompts = generate_prompts_for_batch(batch)
                all_prompts.update(prompts)
                print(f"    ✓ Retry successful: {len(prompts)} products")
            except Exception as e2:
                print(f"    ✗ Retry failed: {e2}. Skipping batch.")
                continue
        except Exception as e:
            print(f"    ✗ Error: {e}. Retrying in 5s...")
            time.sleep(5)
            try:
                prompts = generate_prompts_for_batch(batch)
                all_prompts.update(prompts)
            except Exception as e2:
                print(f"    ✗ Retry failed: {e2}. Skipping batch.")
                continue

        time.sleep(1)  # Rate limiting

    return all_prompts


def main():
    parser = argparse.ArgumentParser(description="Generate image prompts")
    parser.add_argument("--input", type=str, default="products.json",
                        help="Input products file")
    parser.add_argument("--output", type=str, default="image-prompts.json",
                        help="Output prompts file")
    parser.add_argument("--batch-size", type=int, default=10,
                        help="Products per API call")
    args = parser.parse_args()

    base_dir = Path(__file__).parent
    input_path = base_dir / args.input
    output_path = base_dir / args.output

    # Load products
    with open(input_path) as f:
        products = json.load(f)

    print(f"🎨 Generating image prompts for {len(products)} products")
    print(f"   Input: {input_path}")
    print(f"   Output: {output_path}")
    print(f"   Shots per product: 2 (lifestyle + studio)")

    all_prompts = generate_all_prompts(products, batch_size=args.batch_size)

    # Validate coverage
    product_ids = {p["ITEM_ID"] for p in products}
    prompt_ids = set(all_prompts.keys())
    missing = product_ids - prompt_ids

    print(f"\n{'='*60}")
    print(f"Results")
    print(f"{'='*60}")
    print(f"  Products with prompts: {len(prompt_ids)}/{len(product_ids)}")
    if missing:
        print(f"  ⚠️  Missing prompts for: {sorted(missing)[:10]}...")
    else:
        print(f"  ✓ All products covered!")

    # Save
    with open(output_path, "w") as f:
        json.dump(all_prompts, f, indent=2)

    print(f"\n✓ Prompts saved to {output_path}")


if __name__ == "__main__":
    main()
