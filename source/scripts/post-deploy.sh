#!/bin/bash
set -e

REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-retail-personalization-on-aws}"

echo "🚀 Post-deploy setup for $STACK_NAME in $REGION"
echo ""

# Get stack outputs
echo "Fetching stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs" \
    --output json)

IMAGES_BUCKET=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'ImagesBucket' in o['OutputKey']))")
KB_ID=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if o['OutputKey'].endswith('KnowledgeBaseId')))")
DS_ID=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'DataSourceId' in o['OutputKey']))")
PRODUCT_TABLE=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'ProductTable' in o['OutputKey']))")

echo "  Images Bucket: $IMAGES_BUCKET"
echo "  Knowledge Base ID: $KB_ID"
echo "  Data Source ID: $DS_ID"
echo "  Product Table: $PRODUCT_TABLE"
echo ""

# Step 1: Upload product images
echo "📸 Uploading product images to S3..."
aws s3 sync data-generation/images/ "s3://$IMAGES_BUCKET/products/" --region "$REGION" --quiet
echo "  ✓ Images uploaded"
echo ""

# Step 2: Sync Knowledge Base
echo "🧠 Starting Knowledge Base ingestion..."
INGESTION_JOB=$(aws bedrock-agent start-ingestion-job \
    --knowledge-base-id "$KB_ID" \
    --data-source-id "$DS_ID" \
    --region "$REGION" \
    --query "ingestionJob.ingestionJobId" \
    --output text)
echo "  ✓ Ingestion job started: $INGESTION_JOB"
echo "  (This takes a few minutes to complete)"
echo ""

# Step 3: Seed DynamoDB product table
echo "📦 Seeding DynamoDB product table..."
python3 scripts/seed_dynamodb.py --table "$PRODUCT_TABLE" --region "$REGION"
echo ""

echo "✅ Post-deploy setup complete!"
echo ""
echo "Next steps:"
echo "  - Wait for KB ingestion to complete (~5 min)"
echo "  - Create Personalize solution and campaign (see scripts/setup_personalize.py)"
echo "  - Test the AI Shopping Assistant"
