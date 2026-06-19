"""
Step 1: Generate the full product catalog using Claude on Bedrock.

Produces a products.json file with ~200 products across all categories.
Each product has: name, category, subcategory, style, material, color,
dimensions, price, description, room_type, tags, rating, review_count.

Usage:
    python generate_catalog.py [--batch-size 20] [--output products.json]
"""

import argparse
import json
import sys
import time
from pathlib import Path

import boto3

from config import (
    BEDROCK_CONFIG,
    BRAND_DESCRIPTION,
    BRAND_NAME,
    CATEGORIES,
    COLORS,
    CURRENCY,
    ROOM_TYPES,
    STYLES,
    TAGS,
)

bedrock = boto3.client(
    "bedrock-runtime",
    region_name=BEDROCK_CONFIG["region"],
)


SYSTEM_PROMPT = f"""You are a product catalog designer for {BRAND_NAME}, a premium Scandinavian-inspired furniture brand.

Brand description: {BRAND_DESCRIPTION}

Your job is to generate realistic, compelling product entries for our online store.
Each product should feel like it belongs in a curated, high-end furniture collection.

Rules:
- Product names should be distinctive and evocative (e.g., "Oslo Lounge Chair", "Fjord Coffee Table", "Aura Pendant Light")
- Use Scandinavian/Nordic-inspired naming where appropriate
- Descriptions should be 2-3 sentences, written in an editorial, aspirational tone
- Prices should be realistic for premium furniture (not luxury/designer, but high-quality)
- Dimensions should be realistic for the product type (in cm)
- Each product must be unique — no duplicates in name or concept
- Ratings should range from 3.8 to 5.0, with most between 4.2 and 4.8
- Review counts should range from 5 to 400, with newer items having fewer reviews
- Assign 1-3 tags per product from the available tags list
- Assign 1-2 room types per product

Available styles: {json.dumps(list(STYLES.keys()))}
Available colors: {json.dumps(COLORS)}
Available room types: {json.dumps(ROOM_TYPES)}
Available tags: {json.dumps(TAGS)}
"""


def generate_batch(category: str, category_config: dict, start_id: int, batch_size: int) -> list[dict]:
    """Generate a batch of products for a given category."""

    subcategories = category_config["subcategories"]
    materials = category_config["materials"]
    styles = category_config["styles"]
    price_range = category_config["price_range"]

    prompt = f"""Generate exactly {batch_size} products for the "{category}" category.

Subcategories to distribute across: {json.dumps(subcategories)}
Available materials: {json.dumps(materials)}
Available styles: {json.dumps(styles)}
Price range: ${price_range['min']} - ${price_range['max']} {CURRENCY}

Distribute products roughly evenly across subcategories.

Return a JSON array where each product has this exact structure:
{{
    "ITEM_ID": "PROD-{start_id:03d}",
    "name": "Product Name",
    "category": "{category}",
    "subcategory": "One of the subcategories",
    "style": "One of the available styles",
    "material": "Primary material description",
    "color": "Primary color from the palette",
    "price": 999.00,
    "description": "2-3 sentence editorial description.",
    "dimensions": {{"width": 100, "depth": 60, "height": 45, "unit": "cm"}},
    "room_type": ["Room Type 1", "Room Type 2"],
    "rating": 4.5,
    "review_count": 87,
    "tags": ["tag1", "tag2"],
    "in_stock": true
}}

Start ITEM_IDs from PROD-{start_id:03d} and increment sequentially.
Return ONLY the JSON array, no other text."""

    response = bedrock.converse(
        modelId=BEDROCK_CONFIG["text_model_id"],
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        system=[{"text": SYSTEM_PROMPT}],
        inferenceConfig={"maxTokens": 8192, "temperature": 0.7},
    )

    response_text = response["output"]["message"]["content"][0]["text"]

    # Extract JSON from response (handle markdown code blocks)
    if "```json" in response_text:
        response_text = response_text.split("```json")[1].split("```")[0]
    elif "```" in response_text:
        response_text = response_text.split("```")[1].split("```")[0]

    products = json.loads(response_text.strip())
    return products


def generate_full_catalog(batch_size: int = 20) -> list[dict]:
    """Generate the complete product catalog across all categories."""

    all_products = []
    current_id = 1

    for category, config in CATEGORIES.items():
        target = config["target_count"]
        print(f"\n{'='*60}")
        print(f"Generating {target} products for: {category}")
        print(f"{'='*60}")

        category_products = []
        remaining = target

        while remaining > 0:
            batch = min(batch_size, remaining)
            print(f"  Generating batch of {batch} (starting at PROD-{current_id:03d})...")

            try:
                products = generate_batch(category, config, current_id, batch)
                category_products.extend(products)
                current_id += len(products)
                remaining -= len(products)
                print(f"  ✓ Got {len(products)} products. {remaining} remaining.")
            except json.JSONDecodeError as e:
                print(f"  ✗ JSON parse error: {e}. Retrying...")
                time.sleep(2)
                continue
            except Exception as e:
                print(f"  ✗ Error: {e}. Retrying in 5s...")
                time.sleep(5)
                continue

            # Rate limiting — be gentle with the API
            time.sleep(1)

        all_products.extend(category_products)
        print(f"  Total for {category}: {len(category_products)} products")

    return all_products


def validate_catalog(products: list[dict]) -> dict:
    """Run basic validation on the generated catalog."""

    issues = []
    seen_names = set()
    seen_ids = set()

    for p in products:
        # Check for duplicate names
        if p["name"] in seen_names:
            issues.append(f"Duplicate name: {p['name']}")
        seen_names.add(p["name"])

        # Check for duplicate IDs
        if p["ITEM_ID"] in seen_ids:
            issues.append(f"Duplicate ID: {p['ITEM_ID']}")
        seen_ids.add(p["ITEM_ID"])

        # Check required fields
        required = ["ITEM_ID", "name", "category", "subcategory", "style",
                    "material", "color", "price", "description", "dimensions"]
        for field in required:
            if field not in p:
                issues.append(f"{p.get('ITEM_ID', '???')}: missing field '{field}'")

        # Check price range
        if "price" in p and (p["price"] < 10 or p["price"] > 10000):
            issues.append(f"{p['ITEM_ID']}: suspicious price ${p['price']}")

    # Category distribution
    cat_counts = {}
    for p in products:
        cat = p.get("category", "Unknown")
        cat_counts[cat] = cat_counts.get(cat, 0) + 1

    return {
        "total_products": len(products),
        "unique_names": len(seen_names),
        "unique_ids": len(seen_ids),
        "category_distribution": cat_counts,
        "issues": issues,
    }


def main():
    parser = argparse.ArgumentParser(description="Generate product catalog")
    parser.add_argument("--batch-size", type=int, default=20,
                        help="Number of products to generate per API call")
    parser.add_argument("--output", type=str, default="products.json",
                        help="Output file path")
    args = parser.parse_args()

    output_path = Path(__file__).parent / args.output

    print(f"🏪 Generating {BRAND_NAME} product catalog")
    print(f"   Target: ~200 products across {len(CATEGORIES)} categories")
    print(f"   Batch size: {args.batch_size}")
    print(f"   Output: {output_path}")

    products = generate_full_catalog(batch_size=args.batch_size)

    # Validate
    print(f"\n{'='*60}")
    print("Validation Results")
    print(f"{'='*60}")
    validation = validate_catalog(products)
    print(f"  Total products: {validation['total_products']}")
    print(f"  Unique names: {validation['unique_names']}")
    print(f"  Unique IDs: {validation['unique_ids']}")
    print(f"  Category distribution:")
    for cat, count in validation["category_distribution"].items():
        print(f"    {cat}: {count}")
    if validation["issues"]:
        print(f"\n  ⚠️  Issues found ({len(validation['issues'])}):")
        for issue in validation["issues"][:10]:
            print(f"    - {issue}")
    else:
        print("\n  ✓ No issues found!")

    # Save
    with open(output_path, "w") as f:
        json.dump(products, f, indent=2)

    print(f"\n✓ Catalog saved to {output_path}")


if __name__ == "__main__":
    main()
