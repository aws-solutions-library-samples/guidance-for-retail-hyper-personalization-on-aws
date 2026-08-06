"""
Brand identity, style guide, and category definitions for the
Retail Personalization sample product catalog.
"""

import os

# ─── Brand Identity ───────────────────────────────────────────────────────────

BRAND_NAME = "Nordheim"
BRAND_TAGLINE = "Timeless Scandinavian Living"
BRAND_DESCRIPTION = (
    "Nordheim is a premium Scandinavian-inspired furniture and homeware brand "
    "that blends minimalist design with natural materials and expert craftsmanship. "
    "Every piece is designed to bring warmth, function, and quiet elegance to modern homes."
)

CURRENCY = "USD"
PRICE_RANGE = {"min": 29, "max": 4500}

# ─── Style Guide (for image generation consistency) ───────────────────────────

PHOTOGRAPHY_STYLE = {
    "lighting": "soft natural daylight, warm tone",
    "backgrounds": [
        "bright Scandinavian living room with white walls and light oak flooring",
        "minimalist bedroom with neutral linen bedding and soft morning light",
        "modern dining space with large windows and clean lines",
        "cozy reading corner with warm afternoon light",
        "contemporary home office with plants and natural materials",
    ],
    "color_palette": [
        "warm whites", "light oak", "walnut", "charcoal", "sage green",
        "dusty blue", "terracotta", "cream", "brass accents", "matte black",
    ],
    "avoid": [
        "people", "text", "watermarks", "cluttered backgrounds",
        "harsh shadows", "neon colors", "overly saturated tones",
    ],
    "mood": "calm, inviting, editorial, aspirational",
}

# Image dimensions for Nova Canvas
IMAGE_CONFIG = {
    "lifestyle": {"width": 1280, "height": 960},   # 4:3 landscape
    "studio": {"width": 1024, "height": 1024},      # 1:1 square
    "detail": {"width": 1024, "height": 1024},      # 1:1 square
}

# ─── Product Categories ───────────────────────────────────────────────────────

CATEGORIES = {
    "Sofas & Seating": {
        "subcategories": ["Sofas", "Armchairs", "Dining Chairs", "Benches"],
        "target_count": 35,
        "price_range": {"min": 299, "max": 4500},
        "materials": ["linen", "bouclé", "velvet", "leather", "wool blend"],
        "styles": ["Scandinavian", "Mid-Century Modern", "Minimalist", "Contemporary"],
    },
    "Tables": {
        "subcategories": ["Coffee Tables", "Dining Tables", "Side Tables", "Desks"],
        "target_count": 35,
        "price_range": {"min": 199, "max": 3200},
        "materials": ["solid oak", "walnut", "marble", "glass", "ash wood", "travertine"],
        "styles": ["Scandinavian", "Mid-Century Modern", "Minimalist", "Industrial", "Japandi"],
    },
    "Lighting": {
        "subcategories": ["Floor Lamps", "Table Lamps", "Pendant Lights", "Wall Sconces"],
        "target_count": 30,
        "price_range": {"min": 79, "max": 890},
        "materials": ["brass", "matte black metal", "opal glass", "linen shade", "rattan", "ceramic"],
        "styles": ["Scandinavian", "Mid-Century Modern", "Minimalist", "Art Deco", "Japandi"],
    },
    "Storage": {
        "subcategories": ["Bookshelves", "Cabinets", "Sideboards", "TV Units"],
        "target_count": 30,
        "price_range": {"min": 349, "max": 2800},
        "materials": ["solid oak", "walnut", "cane", "fluted glass", "ash wood"],
        "styles": ["Scandinavian", "Mid-Century Modern", "Minimalist", "Contemporary"],
    },
    "Beds & Bedroom": {
        "subcategories": ["Bed Frames", "Nightstands", "Dressers"],
        "target_count": 25,
        "price_range": {"min": 149, "max": 3500},
        "materials": ["solid oak", "walnut", "upholstered linen", "ash wood", "cane"],
        "styles": ["Scandinavian", "Mid-Century Modern", "Minimalist", "Japandi"],
    },
    "Rugs & Textiles": {
        "subcategories": ["Area Rugs", "Throws", "Cushions"],
        "target_count": 25,
        "price_range": {"min": 29, "max": 1200},
        "materials": ["wool", "jute", "cotton", "linen", "silk blend"],
        "styles": ["Scandinavian", "Minimalist", "Bohemian", "Japandi", "Textural"],
    },
    "Decor & Accessories": {
        "subcategories": ["Vases", "Mirrors", "Wall Art", "Planters"],
        "target_count": 20,
        "price_range": {"min": 39, "max": 650},
        "materials": ["ceramic", "stoneware", "brass", "glass", "terrazzo", "travertine"],
        "styles": ["Scandinavian", "Minimalist", "Organic Modern", "Japandi", "Wabi-Sabi"],
    },
}

# ─── Style Definitions ────────────────────────────────────────────────────────

STYLES = {
    "Scandinavian": "Clean lines, light woods, functional simplicity, cozy warmth (hygge)",
    "Mid-Century Modern": "Organic curves, tapered legs, warm wood tones, retro-inspired forms",
    "Minimalist": "Pared-back design, geometric forms, monochromatic palette, no ornamentation",
    "Contemporary": "Current design trends, mixed materials, subtle curves, refined details",
    "Industrial": "Raw materials, metal accents, exposed construction, utilitarian beauty",
    "Japandi": "Japanese minimalism meets Scandinavian warmth, natural materials, wabi-sabi imperfection",
    "Art Deco": "Geometric patterns, luxe materials, brass accents, elegant curves",
    "Bohemian": "Layered textures, natural fibers, handcrafted feel, earthy tones",
    "Organic Modern": "Soft curves, natural forms, earthy materials, biophilic design",
    "Wabi-Sabi": "Embracing imperfection, handmade quality, natural patina, organic shapes",
    "Textural": "Focus on tactile surfaces, woven materials, dimensional interest",
}

# ─── Room Types ───────────────────────────────────────────────────────────────

ROOM_TYPES = [
    "Living Room",
    "Bedroom",
    "Dining Room",
    "Home Office",
    "Hallway",
    "Kitchen",
    "Bathroom",
    "Outdoor",
]

# ─── Color Palette ────────────────────────────────────────────────────────────

COLORS = [
    "Natural Oak", "Walnut", "Charcoal", "Off-White", "Cream",
    "Sage Green", "Dusty Blue", "Terracotta", "Warm Grey", "Matte Black",
    "Brass", "Blush Pink", "Oatmeal", "Forest Green", "Navy",
    "Rust", "Sand", "Slate", "Ivory", "Cognac",
]

# ─── Tags ─────────────────────────────────────────────────────────────────────

TAGS = [
    "bestseller", "new-arrival", "sustainable", "handcrafted",
    "limited-edition", "award-winning", "compact", "statement-piece",
    "family-friendly", "easy-assembly",
]

# ─── Bedrock Model Configuration ─────────────────────────────────────────────
#
# Model IDs are configuration, not source code: foundation models are deprecated
# and replaced over time, so each value below can be overridden with an
# environment variable and requires no code change to swap.
#
# This pipeline is an optional, offline developer tool — the generated catalog,
# images and training data are already committed under data-generation/ — so
# these keep working defaults rather than failing when unset. The deployed
# components (the agent and the Knowledge Base) take the stricter approach and
# fail loudly if their model IDs are missing.
#
#   DATAGEN_TEXT_MODEL_ID    — text generation (product catalog, descriptions)
#   DATAGEN_IMAGE_MODEL_ID   — image generation (product photography)
#   DATAGEN_REGION           — region used for both Bedrock clients
#
# Example:
#   DATAGEN_TEXT_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0 \
#       python generate_catalog.py

DEFAULT_TEXT_MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0"
DEFAULT_IMAGE_MODEL_ID = "amazon.nova-canvas-v1:0"
DEFAULT_REGION = "us-east-1"

BEDROCK_CONFIG = {
    "text_model_id": os.environ.get("DATAGEN_TEXT_MODEL_ID") or DEFAULT_TEXT_MODEL_ID,
    "image_model_id": os.environ.get("DATAGEN_IMAGE_MODEL_ID") or DEFAULT_IMAGE_MODEL_ID,
    "region": os.environ.get("DATAGEN_REGION") or DEFAULT_REGION,
}
