# Data Generation Pipeline

Generates the complete product catalog, images, and training datasets for the
Retail Personalization sample.

## Prerequisites

- Python 3.11+
- AWS credentials configured with access to Amazon Bedrock (Claude + Nova Canvas)
- Bedrock model access enabled for:
  - `us.anthropic.claude-sonnet-4-20250514-v1:0` (text generation)
  - `amazon.nova-canvas-v1:0` (image generation)

## Setup

```bash
pip install -r requirements.txt
```

## Pipeline Steps

Run these in order:

### Step 1: Generate Product Catalog

```bash
python generate_catalog.py
```

Produces `products.json` with ~200 products. Review the output and re-run if
needed — the generation is non-deterministic so each run produces different products.

### Step 2: Generate Image Prompts

```bash
python generate_prompts.py
```

Takes `products.json` and produces `image-prompts.json` with 2 image generation
prompts per product (lifestyle + studio shots).

### Step 3: Generate Product Images

```bash
# Test with a small batch first
python generate_images.py --limit 10

# Generate all images (this takes a while — ~400 API calls)
python generate_images.py --resume

# Generate only lifestyle shots
python generate_images.py --shots lifestyle
```

Produces images in the `images/` directory. Use `--resume` to skip already-generated
images if the process is interrupted.

### Step 4: Assemble Final Datasets

```bash
python assemble_dataset.py
```

Combines everything into the final datasets in `output/`:
- `output/personalize/items.csv` — Amazon Personalize items dataset
- `output/personalize/users.csv` — Amazon Personalize users dataset
- `output/personalize/interactions.csv` — Amazon Personalize interactions dataset
- `output/knowledge-base/*.md` — Knowledge Base documents (one per product)
- `output/dynamodb-seed.json` — DynamoDB product table seed data
- `output/products-final.json` — Complete catalog with image paths

## Configuration

Edit `config.py` to change:
- Brand identity and naming
- Product categories and counts
- Style vocabulary and color palette
- Photography style guide
- Bedrock model IDs and region

## Cost Estimate

- Step 1 (catalog): ~10 Claude API calls → ~$0.50
- Step 2 (prompts): ~20 Claude API calls → ~$1.00
- Step 3 (images): ~400 Nova Canvas calls → ~$16.00 (at $0.04/image)
- Step 4 (assembly): No API calls, local processing

Total: ~$17.50 for the full pipeline.
