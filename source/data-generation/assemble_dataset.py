"""
Step 4: Assemble the final datasets from the generated catalog and images.

Produces:
- output/personalize/items.csv          — Personalize items dataset
- output/personalize/users.csv          — Personalize users dataset
- output/personalize/interactions.csv   — Personalize interactions dataset
- output/knowledge-base/               — One markdown doc per product (for RAG)
- output/dynamodb-seed.json            — DynamoDB batch write format
- output/products-final.json           — Complete catalog with image paths

Usage:
    python assemble_dataset.py
"""

import csv
import json
import random
import time
from datetime import datetime, timedelta
from pathlib import Path

from config import (
    CATEGORIES,
    COLORS,
    ROOM_TYPES,
    STYLES,
    TAGS,
)

BASE_DIR = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "output"


# ─── Personalize Users Generation ─────────────────────────────────────────────

AGE_GROUPS = ["25-34", "35-44", "45-54", "55+"]
STYLE_PREFERENCES = ["Modern", "Scandinavian", "Industrial", "Traditional", "Eclectic"]
BUDGET_TIERS = ["Budget", "Mid-Range", "Premium"]

USER_COUNT = 75


def generate_users() -> list[dict]:
    """Generate synthetic user profiles."""
    users = []
    for i in range(1, USER_COUNT + 1):
        users.append({
            "USER_ID": f"USER-{i:03d}",
            "AGE_GROUP": random.choice(AGE_GROUPS),
            "STYLE_PREFERENCE": random.choice(STYLE_PREFERENCES),
            "BUDGET_TIER": random.choice(BUDGET_TIERS),
        })
    return users


# ─── Personalize Interactions Generation ──────────────────────────────────────

INTERACTION_COUNT = 8000
EVENT_TYPES = ["view", "add_to_cart", "purchase"]
EVENT_WEIGHTS = [0.80, 0.15, 0.05]  # Realistic funnel ratios


def generate_interactions(products: list[dict], users: list[dict]) -> list[dict]:
    """Generate synthetic interaction data with realistic patterns."""

    interactions = []
    product_ids = [p["ITEM_ID"] for p in products]
    user_ids = [u["USER_ID"] for u in users]

    # Create user preference profiles for realistic patterns
    user_profiles = {}
    for user in users:
        # Each user has preferred styles and categories
        preferred_styles = random.sample(list(STYLES.keys()), k=random.randint(1, 3))
        preferred_categories = random.sample(list(CATEGORIES.keys()), k=random.randint(2, 4))
        user_profiles[user["USER_ID"]] = {
            "styles": preferred_styles,
            "categories": preferred_categories,
            "budget": user["BUDGET_TIER"],
        }

    # Build product lookup for preference matching
    product_lookup = {p["ITEM_ID"]: p for p in products}

    # Generate interactions over 90 days
    end_date = datetime.now()
    start_date = end_date - timedelta(days=90)

    for _ in range(INTERACTION_COUNT):
        user_id = random.choice(user_ids)
        profile = user_profiles[user_id]

        # 70% chance of interacting with a preferred product
        if random.random() < 0.7:
            # Filter products matching user preferences
            matching = [
                pid for pid, p in product_lookup.items()
                if p.get("style") in profile["styles"]
                or p.get("category") in profile["categories"]
            ]
            if matching:
                item_id = random.choice(matching)
            else:
                item_id = random.choice(product_ids)
        else:
            item_id = random.choice(product_ids)

        # Generate timestamp
        random_offset = random.uniform(0, (end_date - start_date).total_seconds())
        timestamp = int((start_date + timedelta(seconds=random_offset)).timestamp())

        # Event type with realistic funnel
        event_type = random.choices(EVENT_TYPES, weights=EVENT_WEIGHTS, k=1)[0]

        interactions.append({
            "USER_ID": user_id,
            "ITEM_ID": item_id,
            "EVENT_TYPE": event_type,
            "TIMESTAMP": timestamp,
        })

    # Sort by timestamp
    interactions.sort(key=lambda x: x["TIMESTAMP"])
    return interactions


# ─── Knowledge Base Documents ─────────────────────────────────────────────────

def generate_kb_document(product: dict) -> str:
    """Generate a rich markdown document for the Knowledge Base."""

    dimensions = product.get("dimensions", {})
    dim_str = ""
    if dimensions:
        parts = []
        if "width" in dimensions:
            parts.append(f"{dimensions['width']}cm W")
        if "depth" in dimensions:
            parts.append(f"{dimensions['depth']}cm D")
        if "height" in dimensions:
            parts.append(f"{dimensions['height']}cm H")
        dim_str = " × ".join(parts)

    room_types = product.get("room_type", [])
    if isinstance(room_types, str):
        room_types = [room_types]

    tags = product.get("tags", [])

    doc = f"""# {product['name']}

{product['description']}

## Product Details

- **Category**: {product['category']} > {product['subcategory']}
- **Style**: {product['style']}
- **Material**: {product['material']}
- **Color**: {product['color']}
- **Dimensions**: {dim_str}
- **Price**: ${product['price']:.2f}
- **Rating**: {product.get('rating', 'N/A')} / 5 ({product.get('review_count', 0)} reviews)
- **Room**: {', '.join(room_types)}
- **In Stock**: {'Yes' if product.get('in_stock', True) else 'No'}

## Ideal For

"""

    # Generate "ideal for" based on product attributes
    style = product.get("style", "")
    category = product.get("category", "")
    price = product.get("price", 0)

    ideal_for_parts = []
    if style == "Scandinavian":
        ideal_for_parts.append("lovers of clean Nordic design and natural materials")
    elif style == "Mid-Century Modern":
        ideal_for_parts.append("those who appreciate retro-inspired design with timeless appeal")
    elif style == "Minimalist":
        ideal_for_parts.append("anyone seeking a pared-back, clutter-free aesthetic")
    elif style == "Industrial":
        ideal_for_parts.append("urban spaces and loft-style interiors")
    elif style == "Japandi":
        ideal_for_parts.append("those drawn to the harmony of Japanese and Scandinavian design")
    else:
        ideal_for_parts.append(f"fans of {style.lower()} design")

    if price > 1500:
        ideal_for_parts.append("a statement investment piece for the home")
    elif price < 200:
        ideal_for_parts.append("an affordable way to refresh your space")

    if room_types:
        ideal_for_parts.append(f"styling in the {room_types[0].lower()}")

    doc += "This piece is perfect for " + ", ".join(ideal_for_parts) + "."

    if tags:
        doc += f"\n\n**Tags**: {', '.join(tags)}"

    return doc


# ─── DynamoDB Seed Data ───────────────────────────────────────────────────────

def generate_dynamodb_seed(products: list[dict], image_manifest: dict | None = None) -> list[dict]:
    """Generate DynamoDB-formatted product records."""

    items = []
    for product in products:
        item = {
            "ITEM_ID": {"S": product["ITEM_ID"]},
            "name": {"S": product["name"]},
            "category": {"S": product["category"]},
            "subcategory": {"S": product["subcategory"]},
            "style": {"S": product["style"]},
            "material": {"S": product["material"]},
            "color": {"S": product["color"]},
            "price": {"N": str(product["price"])},
            "description": {"S": product["description"]},
            "dimensions": {"M": {
                "width": {"N": str(product.get("dimensions", {}).get("width", 0))},
                "depth": {"N": str(product.get("dimensions", {}).get("depth", 0))},
                "height": {"N": str(product.get("dimensions", {}).get("height", 0))},
                "unit": {"S": product.get("dimensions", {}).get("unit", "cm")},
            }},
            "room_type": {"L": [{"S": r} for r in product.get("room_type", [])]},
            "rating": {"N": str(product.get("rating", 4.5))},
            "review_count": {"N": str(product.get("review_count", 0))},
            "in_stock": {"BOOL": product.get("in_stock", True)},
            "tags": {"L": [{"S": t} for t in product.get("tags", [])]},
        }

        # Add image URLs if manifest exists
        if image_manifest and product["ITEM_ID"] in image_manifest.get("results", {}):
            images = image_manifest["results"][product["ITEM_ID"]]
            if "lifestyle" in images:
                item["image_lifestyle"] = {"S": images["lifestyle"]}
            if "studio" in images:
                item["image_studio"] = {"S": images["studio"]}

        items.append(item)

    return items


# ─── Main Assembly ────────────────────────────────────────────────────────────

def main():
    products_path = BASE_DIR / "products.json"
    manifest_path = BASE_DIR / "image-manifest.json"

    if not products_path.exists():
        print("✗ products.json not found. Run generate_catalog.py first.")
        return

    with open(products_path) as f:
        products = json.load(f)

    # Load image manifest if available
    image_manifest = None
    if manifest_path.exists():
        with open(manifest_path) as f:
            image_manifest = json.load(f)
        print(f"  Found image manifest with {len(image_manifest.get('results', {}))} products")

    print(f"📦 Assembling datasets from {len(products)} products")

    # Create output directories
    personalize_dir = OUTPUT_DIR / "personalize"
    kb_dir = OUTPUT_DIR / "knowledge-base"
    personalize_dir.mkdir(parents=True, exist_ok=True)
    kb_dir.mkdir(parents=True, exist_ok=True)

    # ── Generate Personalize Items CSV ──
    print("\n  Generating Personalize items.csv...")
    items_path = personalize_dir / "items.csv"
    with open(items_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "ITEM_ID", "CATEGORY", "STYLE", "PRICE", "MATERIAL", "ROOM_TYPE", "COLOR"
        ])
        writer.writeheader()
        for p in products:
            room_type = p.get("room_type", [])
            if isinstance(room_type, list):
                room_type = "|".join(room_type)
            writer.writerow({
                "ITEM_ID": p["ITEM_ID"],
                "CATEGORY": f"{p['category']}|{p['subcategory']}",
                "STYLE": p["style"],
                "PRICE": p["price"],
                "MATERIAL": p["material"],
                "ROOM_TYPE": room_type,
                "COLOR": p["color"],
            })
    print(f"    ✓ {items_path} ({len(products)} items)")

    # ── Generate Personalize Users CSV ──
    print("  Generating Personalize users.csv...")
    users = generate_users()
    users_path = personalize_dir / "users.csv"
    with open(users_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "USER_ID", "AGE_GROUP", "STYLE_PREFERENCE", "BUDGET_TIER"
        ])
        writer.writeheader()
        writer.writerows(users)
    print(f"    ✓ {users_path} ({len(users)} users)")

    # ── Generate Personalize Interactions CSV ──
    print("  Generating Personalize interactions.csv...")
    interactions = generate_interactions(products, users)
    interactions_path = personalize_dir / "interactions.csv"
    with open(interactions_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "USER_ID", "ITEM_ID", "EVENT_TYPE", "TIMESTAMP"
        ])
        writer.writeheader()
        writer.writerows(interactions)
    print(f"    ✓ {interactions_path} ({len(interactions)} interactions)")

    # ── Generate Knowledge Base Documents ──
    print("  Generating Knowledge Base documents...")
    for product in products:
        doc = generate_kb_document(product)
        doc_path = kb_dir / f"{product['ITEM_ID'].lower()}.md"
        with open(doc_path, "w") as f:
            f.write(doc)
    print(f"    ✓ {kb_dir}/ ({len(products)} documents)")

    # ── Generate DynamoDB Seed Data ──
    print("  Generating DynamoDB seed data...")
    dynamodb_items = generate_dynamodb_seed(products, image_manifest)
    dynamodb_path = OUTPUT_DIR / "dynamodb-seed.json"
    with open(dynamodb_path, "w") as f:
        json.dump(dynamodb_items, f, indent=2)
    print(f"    ✓ {dynamodb_path} ({len(dynamodb_items)} items)")

    # ── Save final products with image paths ──
    print("  Generating final products catalog...")
    if image_manifest:
        for product in products:
            pid = product["ITEM_ID"]
            if pid in image_manifest.get("results", {}):
                product["images"] = image_manifest["results"][pid]
    final_path = OUTPUT_DIR / "products-final.json"
    with open(final_path, "w") as f:
        json.dump(products, f, indent=2)
    print(f"    ✓ {final_path}")

    # ── Summary ──
    print(f"\n{'='*60}")
    print(f"Assembly Complete")
    print(f"{'='*60}")
    print(f"  Products: {len(products)}")
    print(f"  Users: {len(users)}")
    print(f"  Interactions: {len(interactions)}")
    print(f"  KB Documents: {len(products)}")
    print(f"  Output directory: {OUTPUT_DIR}/")

    # Event type distribution
    event_counts = {}
    for i in interactions:
        event_counts[i["EVENT_TYPE"]] = event_counts.get(i["EVENT_TYPE"], 0) + 1
    print(f"\n  Interaction distribution:")
    for event_type, count in sorted(event_counts.items()):
        print(f"    {event_type}: {count} ({count/len(interactions)*100:.1f}%)")


if __name__ == "__main__":
    main()
