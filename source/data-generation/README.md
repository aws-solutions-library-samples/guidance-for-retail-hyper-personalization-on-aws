# Data Generation Pipeline

Generates the complete product catalog, images, and training datasets for the
Retail Personalization sample.

## Prerequisites

- Python 3.11+
- AWS credentials configured with access to Amazon Bedrock (Claude + Nova Canvas)
- Bedrock model access enabled for the models configured below (by default
  `us.anthropic.claude-sonnet-4-20250514-v1:0` for text and
  `amazon.nova-canvas-v1:0` for images)

## Setup

```bash
pip install -r requirements.txt
```

## Model Configuration

Model IDs are not hardcoded in the pipeline scripts. The defaults live in
`config.py` (`BEDROCK_CONFIG`) and each can be overridden with an environment
variable, so you can swap models — for example when one is deprecated — without
editing source:

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `DATAGEN_TEXT_MODEL_ID` | `us.anthropic.claude-sonnet-4-20250514-v1:0` | Product catalog and description generation |
| `DATAGEN_IMAGE_MODEL_ID` | `amazon.nova-canvas-v1:0` | Product image generation |
| `DATAGEN_REGION` | `us-east-1` | Region for both Bedrock clients |

```bash
DATAGEN_TEXT_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0 \
    python generate_catalog.py
```

Whichever models you choose must have access enabled in your account for the
region you are running in.

> This pipeline is an optional developer tool — the generated catalog, images and
> training data are already committed to the repository, so you only need to run
> it if you want to regenerate the sample data. The models used by the *deployed*
> application are configured separately, via CDK context (see the main README).

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
