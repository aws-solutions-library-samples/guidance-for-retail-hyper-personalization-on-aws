"""
Seed the DynamoDB product table with the generated catalog.
Uses batch_write_item for efficiency (25 items per batch).

Usage:
    python scripts/seed_dynamodb.py --table <table-name> --region us-east-1
"""

import argparse
import json
import sys
import time
from decimal import Decimal
from pathlib import Path

import boto3


def convert_floats(obj):
    """Recursively convert floats to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_floats(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats(i) for i in obj]
    return obj


def seed_table(table_name: str, region: str):
    dynamodb = boto3.resource("dynamodb", region_name=region)
    table = dynamodb.Table(table_name)

    # Load products
    products_path = Path(__file__).parent.parent / "data-generation" / "output" / "products-final.json"
    with open(products_path) as f:
        products = json.load(f)

    print(f"  Seeding {len(products)} products into {table_name}...")

    # Batch write (25 items max per batch)
    with table.batch_writer() as batch:
        for i, product in enumerate(products):
            item = {
                "ITEM_ID": product["ITEM_ID"],
                "name": product["name"],
                "category": product["category"],
                "subcategory": product["subcategory"],
                "style": product["style"],
                "material": product["material"],
                "color": product["color"],
                "price": Decimal(str(product["price"])),
                "description": product["description"],
                "dimensions": convert_floats(product.get("dimensions", {})),
                "room_type": product.get("room_type", []),
                "rating": Decimal(str(product.get("rating", 0))),
                "review_count": product.get("review_count", 0),
                "in_stock": product.get("in_stock", True),
                "tags": product.get("tags", []),
                "image_lifestyle": f"products/{product['ITEM_ID'].lower()}-lifestyle.png",
                "image_studio": f"products/{product['ITEM_ID'].lower()}-studio.png",
            }

            batch.put_item(Item=item)

            if (i + 1) % 50 == 0:
                print(f"    Written {i + 1}/{len(products)}...")

    print(f"  ✓ {len(products)} products seeded successfully")


def main():
    parser = argparse.ArgumentParser(description="Seed DynamoDB product table")
    parser.add_argument("--table", required=True, help="DynamoDB table name")
    parser.add_argument("--region", default="us-east-1", help="AWS region")
    args = parser.parse_args()

    seed_table(args.table, args.region)


if __name__ == "__main__":
    main()
