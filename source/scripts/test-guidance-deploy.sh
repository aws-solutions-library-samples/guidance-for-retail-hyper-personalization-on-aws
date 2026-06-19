#!/bin/bash
set -e

# ============================================
# Guidance for Retail Personalization on AWS
# Internal CodeBuild Test Deploy Script
# ============================================
# Target: aws/codebuild/amazonlinux-x86_64-standard:5.0
# Fully unattended — no manual input required
# ============================================

# ============================================
# CONFIGURATION
# ============================================
export AWS_REGION="us-east-1"
export AWS_DEFAULT_REGION="us-east-1"
STACK_NAME="retail-personalization-$(date +%s)"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "════════════════════════════════════════════════════════════════"
echo "  Guidance for Retail Personalization on AWS — Test Deploy"
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $AWS_REGION"
echo "  Stack:   $STACK_NAME"
echo "════════════════════════════════════════════════════════════════"

# ============================================
# INSTALL DEPENDENCIES
# ============================================
echo "Installing Node.js dependencies..."
npm install --prefix web-app --silent
npm install --prefix deploy --silent
npm install --prefix js-lambdas --silent
npm install -g aws-cdk

echo "Installing Python dependencies..."
pip install -q boto3

# ============================================
# CDK BOOTSTRAP CHECK
# ============================================
echo "Checking CDK bootstrap..."
CDK_BOOTSTRAP_STACK=$(aws cloudformation describe-stacks --region "$AWS_REGION" \
    --query "Stacks[?StackName=='CDKToolkit'].StackName" --output text 2>/dev/null || echo "")
if [ -z "$CDK_BOOTSTRAP_STACK" ] || [ "$CDK_BOOTSTRAP_STACK" == "None" ]; then
    echo "Running CDK bootstrap..."
    cdk bootstrap "aws://$ACCOUNT_ID/$AWS_REGION"
fi

# ============================================
# BUILD
# ============================================
echo "Building JWT layer..."
bash js-layers/jwt-layer/build.sh

echo "Building web application..."
npm run build --prefix web-app

# ============================================
# DEPLOYMENT
# ============================================
echo "Deploying CDK stacks..."
cd deploy
export STACK_NAME
npx cdk deploy --all --require-approval=never
cd ..

# ============================================
# POST-DEPLOY SETUP
# ============================================
echo "Retrieving stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs" \
    --output json)

IMAGES_BUCKET=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'ImagesBucket' in o['OutputKey']))")
KB_ID=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if o['OutputKey'].endswith('KnowledgeBaseId')))")
DS_ID=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'DataSourceId' in o['OutputKey']))")
PRODUCT_TABLE=$(echo "$OUTPUTS" | python3 -c "import sys,json; outputs=json.load(sys.stdin); print(next(o['OutputValue'] for o in outputs if 'ProductTable' in o['OutputKey']))")

echo "Uploading product images..."
aws s3 sync data-generation/images/ "s3://$IMAGES_BUCKET/products/" --region "$AWS_REGION" --quiet --no-progress

echo "Seeding DynamoDB..."
python3 scripts/seed_dynamodb.py --table "$PRODUCT_TABLE" --region "$AWS_REGION"

echo "Starting Knowledge Base ingestion..."
aws bedrock-agent start-ingestion-job \
    --knowledge-base-id "$KB_ID" \
    --data-source-id "$DS_ID" \
    --region "$AWS_REGION" \
    --output text --query "ingestionJob.ingestionJobId"

echo "Starting Personalize import..."
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
        print(f'  Import started: {ds_type}')
"

# ============================================
# VALIDATION
# ============================================
echo "Validating deployment..."
STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].StackStatus" \
    --output text)
echo "Stack status: $STACK_STATUS"

if [ "$STACK_STATUS" != "CREATE_COMPLETE" ] && [ "$STACK_STATUS" != "UPDATE_COMPLETE" ]; then
    echo "ERROR: Stack deployment failed with status: $STACK_STATUS"
    exit 1
fi

echo ""
echo "✅ Deployment completed successfully!"
echo "Stack: $STACK_NAME"
echo "Region: $AWS_REGION"
