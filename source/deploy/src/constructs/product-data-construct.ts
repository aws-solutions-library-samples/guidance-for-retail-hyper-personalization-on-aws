import * as cdk from "aws-cdk-lib";
import { RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface ProductDataConstructProps {
    readonly stackName: string;
}

/**
 * Deploys the product data layer:
 * - DynamoDB table for product metadata (with DAX-ready schema)
 * - S3 bucket for product images
 * - S3 bucket for Knowledge Base source documents
 * - S3 bucket for Personalize training data
 * - S3 deployment to seed all buckets with generated data
 */
export class ProductDataConstruct extends Construct {
    public readonly productTable: cdk.aws_dynamodb.Table;
    public readonly imagesBucket: cdk.aws_s3.Bucket;
    public readonly knowledgeBaseBucket: cdk.aws_s3.Bucket;
    public readonly personalizeBucket: cdk.aws_s3.Bucket;

    constructor(scope: Construct, id: string, props: ProductDataConstructProps) {
        super(scope, id);

        // ── DynamoDB Product Table ──
        this.productTable = new cdk.aws_dynamodb.Table(this, "ProductTable", {
            tableName: `${props.stackName}-products`,
            partitionKey: { name: "ITEM_ID", type: cdk.aws_dynamodb.AttributeType.STRING },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: cdk.aws_dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // GSI for category browsing
        this.productTable.addGlobalSecondaryIndex({
            indexName: "category-index",
            partitionKey: { name: "category", type: cdk.aws_dynamodb.AttributeType.STRING },
            sortKey: { name: "subcategory", type: cdk.aws_dynamodb.AttributeType.STRING },
            projectionType: cdk.aws_dynamodb.ProjectionType.ALL,
        });

        // ── S3 Bucket: Product Images ──
        this.imagesBucket = new cdk.aws_s3.Bucket(this, "ImagesBucket", {
            bucketName: `${props.stackName}-product-images-${cdk.Stack.of(this).account}`,
            encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            cors: [
                {
                    allowedMethods: [cdk.aws_s3.HttpMethods.GET],
                    allowedOrigins: ["*"],
                    allowedHeaders: ["*"],
                },
            ],
        });

        // ── S3 Bucket: Knowledge Base Documents ──
        this.knowledgeBaseBucket = new cdk.aws_s3.Bucket(this, "KnowledgeBaseBucket", {
            bucketName: `${props.stackName}-kb-docs-${cdk.Stack.of(this).account}`,
            encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // ── S3 Bucket: Personalize Training Data ──
        this.personalizeBucket = new cdk.aws_s3.Bucket(this, "PersonalizeBucket", {
            bucketName: `${props.stackName}-personalize-data-${cdk.Stack.of(this).account}`,
            encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // ── Seed Knowledge Base Documents ──
        new cdk.aws_s3_deployment.BucketDeployment(this, "KBDocsDeploy", {
            sources: [cdk.aws_s3_deployment.Source.asset("../data-generation/output/knowledge-base")],
            destinationBucket: this.knowledgeBaseBucket,
            destinationKeyPrefix: "products/",
        });

        // ── Seed Personalize Training Data ──
        new cdk.aws_s3_deployment.BucketDeployment(this, "PersonalizeDataDeploy", {
            sources: [cdk.aws_s3_deployment.Source.asset("../data-generation/output/personalize")],
            destinationBucket: this.personalizeBucket,
            destinationKeyPrefix: "training-data/",
        });

        // Note: Product images are uploaded post-deploy via the setup script
        // (too large for CDK BucketDeployment Lambda — 400 images, ~600MB)

        // ── Outputs ──
        new cdk.CfnOutput(this, "ProductTableName", {
            value: this.productTable.tableName,
        });
        new cdk.CfnOutput(this, "ImagesBucketName", {
            value: this.imagesBucket.bucketName,
            description: "Upload product images here post-deploy: aws s3 sync data-generation/images/ s3://<bucket>/products/",
        });
        new cdk.CfnOutput(this, "KnowledgeBaseBucketName", {
            value: this.knowledgeBaseBucket.bucketName,
        });
    }
}
