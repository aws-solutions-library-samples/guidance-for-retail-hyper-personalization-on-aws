#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Guidance for Retail Hyper-Personalization on AWS — One-Click Deploy Script
# ──────────────────────────────────────────────────────────────────────────────
# Deploys the full solution non-interactively. All prerequisite resources are
# created within this script. No manual input required.
#
# Prerequisites:
# - AWS CLI v2 configured with appropriate credentials
# - Node.js >= 18
# - Python >= 3.11
# - Docker running (for agent container build)
# - AWS CDK bootstrapped in target account/region
#
# Usage:
#   chmod +x deployment/deploy.sh
#   ./deployment/deploy.sh
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Static Parameters ─────────────────────────────────────────────────────────
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
STACK_NAME="${STACK_NAME:-retail-personalization-on-aws}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$REPO_DIR/source"

cd "$PROJECT_DIR"

echo "════════════════════════════════════════════════════════════════"
echo "  Guidance for Retail Hyper-Personalization on AWS"
echo "  Region: ${AWS_REGION}"
echo "  Stack:  ${STACK_NAME}"
echo "════════════════════════════════════════════════════════════════"
echo ""

# ── Prerequisite checks ───────────────────────────────────────────────────────
echo "🔍 Checking prerequisites..."
command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI is required. Install: https://aws.amazon.com/cli/"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ Node.js >= 18 is required. Install: https://nodejs.org/"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "❌ Python 3.11+ is required."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required for agent container build."; exit 1; }
docker info >/dev/null 2>&1 || { echo "❌ Docker is not running. Please start Docker."; exit 1; }

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ required, found v$NODE_VERSION"
    exit 1
fi
echo "  ✓ All prerequisites met"
echo ""

# ── Step 1: Install dependencies ──────────────────────────────────────────────
echo "📦 Step 1/8: Installing dependencies..."
npm install --prefix web-app --loglevel=error
npm install --prefix deploy --loglevel=error
npm install --prefix js-lambdas --loglevel=error
# Create a virtual environment for Python dependencies
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --quiet --disable-pip-version-check --no-input boto3
echo "  ✓ Dependencies installed"
echo ""

# ── Step 2: Build JWT Lambda layer ────────────────────────────────────────────
echo "🔑 Step 2/8: Building JWT Lambda layer..."
bash js-layers/jwt-layer/build.sh
echo "  ✓ JWT layer built"
echo ""

# ── Step 3: Build web application ─────────────────────────────────────────────
echo "🌐 Step 3/8: Building web application..."
npm run build --prefix web-app
echo "  ✓ Web app built"
echo ""

# ── Step 4: Deploy CDK stacks ─────────────────────────────────────────────────
echo "☁️  Step 4/8: Deploying CDK infrastructure..."
echo "    (This takes 10-15 minutes for initial deployment)"
cd deploy
npx cdk deploy --all --require-approval=never
cd "$PROJECT_DIR"
echo "  ✓ Infrastructure deployed"
echo ""

# ── Step 5: Get stack outputs ─────────────────────────────────────────────────
echo "📋 Step 5/8: Retrieving stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs" \
    --output json)

IMAGES_BUCKET=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'ImagesBucket' in o['OutputKey']))")
KB_ID=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if o['OutputKey'].endswith('KnowledgeBaseId')))")
DS_ID=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'DataSourceId' in o['OutputKey']))")
PRODUCT_TABLE=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'ProductTable' in o['OutputKey']))")
CF_URL=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next((o['OutputValue'] for o in outputs if 'CloudFrontDistributionUrl' in o['OutputKey']), ''))")
USER_POOL_ID=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next((o['OutputValue'] for o in outputs if 'UserPoolId' in o['OutputKey']), ''))")

echo "  Images Bucket:    $IMAGES_BUCKET"
echo "  Knowledge Base:   $KB_ID"
echo "  Product Table:    $PRODUCT_TABLE"
echo ""

# ── Step 6: Upload product images and seed data ───────────────────────────────
echo "📸 Step 6/8: Uploading product images to S3..."
aws s3 sync data-generation/images/ "s3://$IMAGES_BUCKET/products/" \
    --region "$AWS_REGION" --quiet --no-progress
echo "  ✓ Images uploaded"

echo "   Seeding DynamoDB product table..."
python3 scripts/seed_dynamodb.py --table "$PRODUCT_TABLE" --region "$AWS_REGION"
echo ""

# ── Step 7: Sync Knowledge Base ───────────────────────────────────────────────
echo "🧠 Step 7/8: Starting Knowledge Base ingestion..."
INGESTION_JOB=$(aws bedrock-agent start-ingestion-job \
    --knowledge-base-id "$KB_ID" \
    --data-source-id "$DS_ID" \
    --region "$AWS_REGION" \
    --query "ingestionJob.ingestionJobId" \
    --output text)
echo "  ✓ Ingestion started (job: $INGESTION_JOB)"
echo ""

# ── Step 8: Start Personalize import and training ─────────────────────────────
echo "🤖 Step 8/8: Starting Personalize data import and model training..."
echo "    (Import takes ~10 min, training takes 1-2 hours)"

# Get Personalize details from outputs
DATASET_GROUP_ARN=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'DatasetGroupArn' in o['OutputKey']))")
ROLE_ARN=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'PersonalizeRoleArn' in o['OutputKey']))")
PERSONALIZE_BUCKET=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'PersonalizeBucketName' in o['OutputKey']))")

# Start import jobs (non-blocking)
python3 -c "
import boto3, time, json
personalize = boto3.client('personalize', region_name='$AWS_REGION')

datasets = personalize.list_datasets(datasetGroupArn='$DATASET_GROUP_ARN')
dataset_map = {d['datasetType']: d['datasetArn'] for d in datasets['datasets']}

for ds_type, filename in [('INTERACTIONS','interactions.csv'),('ITEMS','items.csv'),('USERS','users.csv')]:
    if ds_type in dataset_map:
        resp = personalize.create_dataset_import_job(
            jobName='$STACK_NAME-' + ds_type.lower() + '-import-' + str(int(time.time())),
            datasetArn=dataset_map[ds_type],
            dataSource={'dataLocation': 's3://$PERSONALIZE_BUCKET/training-data/' + filename},
            roleArn='$ROLE_ARN',
        )
        print(f'  Started import: {ds_type}')
print('  ✓ All import jobs started (training will begin after imports complete)')
"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo "════════════════════════════════════════════════════════════════"
echo ""
if [ -n "$CF_URL" ]; then
    echo "  🌐 Storefront URL: $CF_URL"
fi
echo ""
echo "  👤 Create a test user:"
echo "     aws cognito-idp admin-create-user \\"
echo "       --user-pool-id $USER_POOL_ID \\"
echo "       --username demo \\"
echo "       --temporary-password 'TempPass123!' \\"
echo "       --region $AWS_REGION"
echo ""
echo "  ⏳ Personalize model training takes 1-2 hours."
echo "     Once imports complete, start training:"
echo "     python3 source/scripts/setup_personalize.py --region $AWS_REGION --skip-import"
echo ""
echo "     Once training is ACTIVE, create the campaign:"
echo "     python3 source/scripts/setup_personalize.py --region $AWS_REGION --skip-import --skip-training"
echo ""
