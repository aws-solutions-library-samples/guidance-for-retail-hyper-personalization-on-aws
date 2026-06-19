import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface PersonalizeConstructProps {
    readonly stackName: string;
    readonly personalizeBucket: cdk.aws_s3.Bucket;
}

/**
 * Deploys Amazon Personalize resources:
 * - Dataset group
 * - Schemas (items, users, interactions)
 * - Datasets (without import jobs — import is triggered post-deploy)
 * - IAM role for Personalize to access S3
 *
 * Post-deploy steps (handled by a setup script):
 * 1. Create dataset import jobs to load training data from S3
 * 2. Create solution (model training — takes 1-2 hours)
 * 3. Create campaign (inference endpoint)
 */
export class PersonalizeConstruct extends Construct {
    public readonly datasetGroupArn: string;
    public readonly personalizeRole: cdk.aws_iam.Role;

    constructor(scope: Construct, id: string, props: PersonalizeConstructProps) {
        super(scope, id);

        // ── IAM Role for Personalize ──
        this.personalizeRole = new cdk.aws_iam.Role(this, "PersonalizeRole", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("personalize.amazonaws.com"),
            description: "Role for Amazon Personalize to access training data in S3",
        });

        props.personalizeBucket.grantRead(this.personalizeRole);

        this.personalizeRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["s3:GetObject", "s3:ListBucket"],
            resources: [
                props.personalizeBucket.bucketArn,
                `${props.personalizeBucket.bucketArn}/*`,
            ],
        }));

        // Bucket policy: allow Personalize service to read training data
        props.personalizeBucket.addToResourcePolicy(new cdk.aws_iam.PolicyStatement({
            sid: "PersonalizeS3Access",
            effect: cdk.aws_iam.Effect.ALLOW,
            principals: [new cdk.aws_iam.ServicePrincipal("personalize.amazonaws.com")],
            actions: ["s3:GetObject", "s3:ListBucket"],
            resources: [
                props.personalizeBucket.bucketArn,
                `${props.personalizeBucket.bucketArn}/*`,
            ],
        }));

        // ── Dataset Group ──
        const datasetGroup = new cdk.aws_personalize.CfnDatasetGroup(this, "DatasetGroup", {
            name: `${props.stackName}-retail-personalization`,
        });

        this.datasetGroupArn = datasetGroup.attrDatasetGroupArn;

        // ── Schemas ──
        const interactionsSchema = new cdk.aws_personalize.CfnSchema(this, "InteractionsSchema", {
            name: `${props.stackName}-interactions`,
            schema: JSON.stringify({
                type: "record",
                name: "Interactions",
                namespace: "com.amazonaws.personalize.schema",
                fields: [
                    { name: "USER_ID", type: "string" },
                    { name: "ITEM_ID", type: "string" },
                    { name: "EVENT_TYPE", type: "string" },
                    { name: "TIMESTAMP", type: "long" },
                ],
                version: "1.0",
            }),
        });

        const itemsSchema = new cdk.aws_personalize.CfnSchema(this, "ItemsSchema", {
            name: `${props.stackName}-items`,
            schema: JSON.stringify({
                type: "record",
                name: "Items",
                namespace: "com.amazonaws.personalize.schema",
                fields: [
                    { name: "ITEM_ID", type: "string" },
                    { name: "CATEGORY", type: "string", categorical: true },
                    { name: "STYLE", type: "string", categorical: true },
                    { name: "PRICE", type: "float" },
                    { name: "MATERIAL", type: "string", categorical: true },
                    { name: "ROOM_TYPE", type: "string", categorical: true },
                    { name: "COLOR", type: "string", categorical: true },
                ],
                version: "1.0",
            }),
        });

        const usersSchema = new cdk.aws_personalize.CfnSchema(this, "UsersSchema", {
            name: `${props.stackName}-users`,
            schema: JSON.stringify({
                type: "record",
                name: "Users",
                namespace: "com.amazonaws.personalize.schema",
                fields: [
                    { name: "USER_ID", type: "string" },
                    { name: "AGE_GROUP", type: "string", categorical: true },
                    { name: "STYLE_PREFERENCE", type: "string", categorical: true },
                    { name: "BUDGET_TIER", type: "string", categorical: true },
                ],
                version: "1.0",
            }),
        });

        // ── Datasets (without import jobs) ──
        const interactionsDataset = new cdk.aws_personalize.CfnDataset(this, "InteractionsDataset", {
            name: `${props.stackName}-interactions`,
            datasetGroupArn: datasetGroup.attrDatasetGroupArn,
            datasetType: "Interactions",
            schemaArn: interactionsSchema.attrSchemaArn,
        });
        interactionsDataset.addDependency(datasetGroup);

        const itemsDataset = new cdk.aws_personalize.CfnDataset(this, "ItemsDataset", {
            name: `${props.stackName}-items`,
            datasetGroupArn: datasetGroup.attrDatasetGroupArn,
            datasetType: "Items",
            schemaArn: itemsSchema.attrSchemaArn,
        });
        itemsDataset.addDependency(datasetGroup);

        const usersDataset = new cdk.aws_personalize.CfnDataset(this, "UsersDataset", {
            name: `${props.stackName}-users`,
            datasetGroupArn: datasetGroup.attrDatasetGroupArn,
            datasetType: "Users",
            schemaArn: usersSchema.attrSchemaArn,
        });
        usersDataset.addDependency(datasetGroup);

        // ── Outputs ──
        new cdk.CfnOutput(this, "DatasetGroupArn", {
            value: datasetGroup.attrDatasetGroupArn,
        });
        new cdk.CfnOutput(this, "PersonalizeRoleArn", {
            value: this.personalizeRole.roleArn,
        });
        new cdk.CfnOutput(this, "PersonalizeBucketName", {
            value: props.personalizeBucket.bucketName,
            description: "S3 bucket containing Personalize training data",
        });
    }
}
