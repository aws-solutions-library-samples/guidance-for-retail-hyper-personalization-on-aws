#!/bin/bash
set -e

# ============================================
# Guidance for Retail Personalization on AWS
# User-Facing Deploy Script
# ============================================

# ============================================
# CONFIGURATION
# ============================================
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-retail-personalization-on-aws}"

# ============================================
# PLATFORM DETECTION
# ============================================
detect_platform() {
    case "$(uname -s)" in
        Darwin*)  PLATFORM="macos" ;;
        Linux*)   PLATFORM="linux" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *)        PLATFORM="unknown" ;;
    esac
    echo "Detected platform: $PLATFORM"
}

# ============================================
# PREREQUISITE CHECKS
# ============================================
check_prerequisites() {
    echo "Checking prerequisites..."
    command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI is required. Install: https://aws.amazon.com/cli/"; exit 1; }
    command -v node >/dev/null 2>&1 || { echo "❌ Node.js >= 18 is required. Install: https://nodejs.org/"; exit 1; }
    command -v python3 >/dev/null 2>&1 || { echo "❌ Python 3.11+ is required."; exit 1; }
    command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required for agent container build."; exit 1; }
    command -v npx >/dev/null 2>&1 || { echo "❌ npx is required (comes with Node.js)."; exit 1; }

    # Check Node version
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo "❌ Node.js 18+ required, found v$NODE_VERSION"
        exit 1
    fi

    # Check Docker is running
    docker info >/dev/null 2>&1 || { echo "❌ Docker is not running. Please start Docker."; exit 1; }

    echo "  ✓ All prerequisites met"
}

# ============================================
# ENVIRONMENT SETUP
# ============================================
detect_platform
check_prerequisites

export AWS_REGION
export AWS_DEFAULT_REGION="$AWS_REGION"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Guidance for Retail Personalization on AWS"
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $AWS_REGION"
echo "  Stack:   $STACK_NAME"
echo "════════════════════════════════════════════════════════════════"
echo ""

# ============================================
# CDK BOOTSTRAP CHECK
# ============================================
echo "Checking CDK bootstrap..."
CDK_BOOTSTRAP_STACK=$(aws cloudformation describe-stacks --region "$AWS_REGION" \
    --query "Stacks[?StackName=='CDKToolkit'].StackName" --output text 2>/dev/null || echo "")
if [ -z "$CDK_BOOTSTRAP_STACK" ] || [ "$CDK_BOOTSTRAP_STACK" == "None" ]; then
    echo "  Running CDK bootstrap..."
    npx cdk bootstrap "aws://$ACCOUNT_ID/$AWS_REGION"
fi
echo "  ✓ CDK bootstrapped"
echo ""

# ============================================
# INSTALL DEPENDENCIES
# ============================================
echo "📦 Installing dependencies..."
npm install --prefix web-app --silent 2>/dev/null
npm install --prefix deploy --silent 2>/dev/null
npm install --prefix js-lambdas --silent 2>/dev/null
pip install -q boto3 2>/dev/null
echo "  ✓ Dependencies installed"
echo ""

# ============================================
# BUILD
# ============================================
echo "🔨 Building..."
bash js-layers/jwt-layer/build.sh > /dev/null 2>&1
echo "  ✓ JWT layer built"
npm run build --prefix web-app --silent 2>/dev/null
echo "  ✓ Web app built"
echo ""

# ============================================
# DEPLOYMENT
# ============================================
echo "☁️  Deploying CDK infrastructure (10-15 minutes)..."
cd deploy
npx cdk deploy --all --require-approval=never
cd "$PROJECT_DIR"
echo "  ✓ Infrastructure deployed"
echo ""

# ============================================
# POST-DEPLOY DATA SETUP
# ============================================
echo "📋 Retrieving stack outputs..."
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

echo "📸 Uploading product images..."
aws s3 sync data-generation/images/ "s3://$IMAGES_BUCKET/products/" --region "$AWS_REGION" --quiet --no-progress
echo "  ✓ Images uploaded"

echo "📦 Seeding product database..."
python3 scripts/seed_dynamodb.py --table "$PRODUCT_TABLE" --region "$AWS_REGION"

echo "🧠 Starting Knowledge Base ingestion..."
aws bedrock-agent start-ingestion-job \
    --knowledge-base-id "$KB_ID" \
    --data-source-id "$DS_ID" \
    --region "$AWS_REGION" \
    --output text --query "ingestionJob.ingestionJobId" > /dev/null
echo "  ✓ Knowledge Base ingestion started"

echo "🤖 Starting Personalize data import..."
DATASET_GROUP_ARN=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'DatasetGroupArn' in o['OutputKey']))")
ROLE_ARN=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'PersonalizeRoleArn' in o['OutputKey']))")
PERSONALIZE_BUCKET=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'PersonalizeBucketName' in o['OutputKey']))")

python3 -c "
import boto3, time
personalize = boto3.client('personalize', region_name='$AWS_REGION')
datasets = personalize.list_datasets(datasetGroupArn='$DATASET_GROUP_ARN')
dataset_map = {d['datasetType']: d['datasetArn'] for d in datasets['datasets']}
for ds_type, filename in [('INTERACTIONS','interactions.csv'),('ITEMS','items.csv'),('USERS','users.csv')]:
    if ds_type in dataset_map:
        personalize.create_dataset_import_job(
            jobName='$STACK_NAME-' + ds_type.lower() + '-' + str(int(time.time())),
            datasetArn=dataset_map[ds_type],
            dataSource={'dataLocation': 's3://$PERSONALIZE_BUCKET/training-data/' + filename},
            roleArn='$ROLE_ARN',
        )
print('  ✓ Personalize import jobs started')
"
echo ""

# ============================================
# VALIDATION
# ============================================
echo "✅ Validating deployment..."
STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].StackStatus" \
    --output text)
echo "  Stack status: $STACK_STATUS"
if [ "$STACK_STATUS" != "CREATE_COMPLETE" ] && [ "$STACK_STATUS" != "UPDATE_COMPLETE" ]; then
    echo "  ⚠️  Stack is not in a healthy state"
fi
echo ""

# ============================================
# SUMMARY
# ============================================
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "  🌐 Storefront: $CF_URL"
echo ""
echo "  👤 Create a test user:"
echo "     aws cognito-idp admin-create-user \\"
echo "       --user-pool-id $USER_POOL_ID \\"
echo "       --username demo \\"
echo "       --temporary-password 'TempPass123!' \\"
echo "       --region $AWS_REGION"
echo ""
echo "  ⏳ Personalize training takes 1-2 hours. Once imports complete:"
echo "     python3 scripts/setup_personalize.py --region $AWS_REGION --skip-import"
echo "     python3 scripts/setup_personalize.py --region $AWS_REGION --skip-import --skip-training"
echo ""
echo "  🧹 To clean up:"
echo "     cd deploy && npx cdk destroy --all --force"
echo ""
