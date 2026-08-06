import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface KnowledgeBaseConstructProps {
    readonly stackName: string;
    readonly knowledgeBaseBucket: cdk.aws_s3.Bucket;
    /**
     * Bedrock embedding model ID, e.g. "amazon.titan-embed-text-v2:0".
     * Supplied from CDK context so the model can be swapped without code
     * changes — see cdk.json.
     */
    readonly embeddingModelId: string;
    /**
     * Vector dimensions produced by `embeddingModelId` (1024 for
     * amazon.titan-embed-text-v2:0).
     *
     * This value is written into the OpenSearch Serverless vector index
     * mapping, which is immutable once created. Changing the embedding model
     * without changing this to match will cause ingestion to fail, and changing
     * either one on an existing deployment requires the index and Knowledge
     * Base to be recreated.
     */
    readonly embeddingModelDimensions: number;
}

/**
 * Deploys a Bedrock Knowledge Base backed by OpenSearch Serverless:
 * - OpenSearch Serverless collection (vector search)
 * - CfnIndex for the vector index (native CloudFormation resource)
 * - Bedrock Knowledge Base with S3 data source
 * - IAM roles for Bedrock to access S3 and OpenSearch
 */
export class KnowledgeBaseConstruct extends Construct {
    public readonly knowledgeBaseId: string;
    public readonly knowledgeBaseArn: string;
    public readonly collectionArn: string;
    public readonly dataSourceId: string;

    constructor(scope: Construct, id: string, props: KnowledgeBaseConstructProps) {
        super(scope, id);

        const stack = cdk.Stack.of(this);
        // Collection name must be unique per account/region, <= 32 chars, lowercase + hyphens only
        const collectionName = `${props.stackName.toLowerCase().slice(0, 20)}-kb`;
        const indexName = "product-catalog-index";
        const embeddingModelArn = `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/${props.embeddingModelId}`;
        const embeddingDimensions = props.embeddingModelDimensions;

        // ── IAM Role for Bedrock Knowledge Base ──
        const kbRole = new cdk.aws_iam.Role(this, "KBRole", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("bedrock.amazonaws.com"),
            inlinePolicies: {
                BedrockKBPolicy: new cdk.aws_iam.PolicyDocument({
                    statements: [
                        new cdk.aws_iam.PolicyStatement({
                            sid: "EmbeddingModelAccess",
                            actions: ["bedrock:InvokeModel"],
                            resources: [embeddingModelArn],
                        }),
                        new cdk.aws_iam.PolicyStatement({
                            sid: "S3Access",
                            actions: ["s3:GetObject", "s3:ListBucket"],
                            resources: [
                                props.knowledgeBaseBucket.bucketArn,
                                `${props.knowledgeBaseBucket.bucketArn}/*`,
                            ],
                        }),
                        // NOTE: aoss:APIAccessAll is granted further down, scoped
                        // to this collection's ARN. It cannot live in this inline
                        // policy: the collection depends on the data access policy,
                        // which depends on this role, so referencing the collection
                        // ARN from the role resource itself would create a
                        // CloudFormation dependency cycle. Attaching it as a
                        // separate IAM policy breaks the cycle.
                    ],
                }),
            },
        });

        // ── OpenSearch Serverless Collection ──

        const encryptionPolicy = new cdk.aws_opensearchserverless.CfnSecurityPolicy(this, "EncryptionPolicy", {
            name: `${collectionName}-enc`,
            type: "encryption",
            policy: JSON.stringify({
                Rules: [{ ResourceType: "collection", Resource: [`collection/${collectionName}`] }],
                AWSOwnedKey: true,
            }),
        });

        const networkPolicy = new cdk.aws_opensearchserverless.CfnSecurityPolicy(this, "NetworkPolicy", {
            name: `${collectionName}-net`,
            type: "network",
            policy: JSON.stringify([
                {
                    Rules: [
                        { ResourceType: "collection", Resource: [`collection/${collectionName}`] },
                        { ResourceType: "dashboard", Resource: [`collection/${collectionName}`] },
                    ],
                    AllowFromPublic: true,
                },
            ]),
        });

        // CloudFormation needs AOSS data-plane access to create CfnIndex resources.
        const cfnExecRoleArn = `arn:${cdk.Aws.PARTITION}:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-hnb659fds-cfn-exec-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;

        const accessPolicy = new cdk.aws_opensearchserverless.CfnAccessPolicy(this, "AccessPolicy", {
            name: `${collectionName}-access`,
            type: "data",
            policy: JSON.stringify([
                {
                    Description: "KB data access",
                    Rules: [
                        {
                            ResourceType: "collection",
                            Resource: [`collection/${collectionName}`],
                            Permission: [
                                "aoss:DescribeCollectionItems",
                                "aoss:CreateCollectionItems",
                                "aoss:UpdateCollectionItems",
                            ],
                        },
                        {
                            ResourceType: "index",
                            Resource: [`index/${collectionName}/*`],
                            Permission: [
                                "aoss:CreateIndex", "aoss:UpdateIndex", "aoss:DescribeIndex",
                                "aoss:ReadDocument", "aoss:WriteDocument", "aoss:DeleteIndex",
                            ],
                        },
                    ],
                    Principal: [kbRole.roleArn, cfnExecRoleArn],
                },
            ]),
        });

        const collection = new cdk.aws_opensearchserverless.CfnCollection(this, "Collection", {
            name: collectionName,
            type: "VECTORSEARCH",
        });
        collection.addDependency(encryptionPolicy);
        collection.addDependency(networkPolicy);
        collection.addDependency(accessPolicy);

        this.collectionArn = collection.attrArn;

        // Data-plane access for Bedrock, scoped to this collection's ARN rather
        // than every collection in the account. Attached as a standalone policy
        // (not an inline policy on kbRole) to avoid the dependency cycle
        // described above.
        const kbCollectionAccessPolicy = new cdk.aws_iam.Policy(this, "KBCollectionAccessPolicy", {
            statements: [
                new cdk.aws_iam.PolicyStatement({
                    sid: "OpenSearchServerlessDataPlaneAccess",
                    actions: ["aoss:APIAccessAll"],
                    resources: [collection.attrArn],
                }),
            ],
        });
        kbCollectionAccessPolicy.attachToRole(kbRole);

        // ── Wait for Collection to be ACTIVE ──
        const waitForCollection = new cdk.custom_resources.AwsCustomResource(this, "WaitForCollection", {
            onCreate: {
                service: "OpenSearchServerless",
                action: "batchGetCollection",
                // Called by name, not id: the aoss:collection condition key on the
                // policy below is evaluated against the collection name, so a
                // name-based request keeps the authorization unambiguous.
                parameters: { names: [collectionName] },
                physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(collection.attrId),
            },
            onUpdate: {
                service: "OpenSearchServerless",
                action: "batchGetCollection",
                // Called by name, not id: the aoss:collection condition key on the
                // policy below is evaluated against the collection name, so a
                // name-based request keeps the authorization unambiguous.
                parameters: { names: [collectionName] },
                physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(collection.attrId),
            },
            policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
                // aoss:BatchGetCollection does not support resource-level ARNs.
                // AWS's documented least-privilege pattern for it is Resource "*"
                // constrained by the aoss:collection condition key, which is what
                // we use here to limit the call to this collection by name.
                // https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-collection-permissions.html
                new cdk.aws_iam.PolicyStatement({
                    sid: "DescribeThisCollectionOnly",
                    actions: ["aoss:BatchGetCollection"],
                    resources: ["*"],
                    conditions: {
                        StringEquals: { "aoss:collection": collectionName },
                    },
                }),
            ]),
            timeout: cdk.Duration.minutes(5),
        });
        waitForCollection.node.addDependency(collection);

        // ── Vector Index (native CfnIndex — requires CDK >=2.234) ──
        const vectorFieldMapping = {
            "bedrock-knowledge-base-default-vector": {
                type: "knn_vector",
                dimension: embeddingDimensions,
                method: {
                    name: "hnsw",
                    engine: "faiss",
                    spaceType: "l2",
                    parameters: { m: 16, efConstruction: 128 },
                },
            },
            AMAZON_BEDROCK_TEXT_CHUNK: { type: "text", index: true },
            AMAZON_BEDROCK_METADATA: { type: "text", index: false },
        };

        const vectorIndex = new cdk.aws_opensearchserverless.CfnIndex(this, "VectorIndex", {
            collectionEndpoint: collection.attrCollectionEndpoint,
            indexName: indexName,
            mappings: { properties: vectorFieldMapping },
            settings: { index: { knn: true, knnAlgoParamEfSearch: 128 } },
        });
        vectorIndex.addDependency(collection);
        vectorIndex.node.addDependency(waitForCollection);

        // Wait for index to be fully ready before creating KB
        const waitForIndex = new cdk.custom_resources.AwsCustomResource(this, "WaitForIndex", {
            onCreate: {
                service: "OpenSearchServerless",
                action: "batchGetCollection",
                // Called by name, not id: the aoss:collection condition key on the
                // policy below is evaluated against the collection name, so a
                // name-based request keeps the authorization unambiguous.
                parameters: { names: [collectionName] },
                physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
                    `${collection.attrId}-index-ready`,
                ),
            },
            onUpdate: {
                service: "OpenSearchServerless",
                action: "batchGetCollection",
                // Called by name, not id: the aoss:collection condition key on the
                // policy below is evaluated against the collection name, so a
                // name-based request keeps the authorization unambiguous.
                parameters: { names: [collectionName] },
                physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
                    `${collection.attrId}-index-ready`,
                ),
            },
            policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
                // aoss:BatchGetCollection does not support resource-level ARNs.
                // AWS's documented least-privilege pattern for it is Resource "*"
                // constrained by the aoss:collection condition key, which is what
                // we use here to limit the call to this collection by name.
                // https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-collection-permissions.html
                new cdk.aws_iam.PolicyStatement({
                    sid: "DescribeThisCollectionOnly",
                    actions: ["aoss:BatchGetCollection"],
                    resources: ["*"],
                    conditions: {
                        StringEquals: { "aoss:collection": collectionName },
                    },
                }),
            ]),
            installLatestAwsSdk: false,
            timeout: cdk.Duration.minutes(5),
        });
        waitForIndex.node.addDependency(vectorIndex);

        // ── Bedrock Knowledge Base ──
        const knowledgeBase = new cdk.aws_bedrock.CfnKnowledgeBase(this, "KnowledgeBase", {
            name: `${props.stackName}-product-catalog`,
            description: "Product catalog for semantic search — powers the AI Shopping Assistant",
            roleArn: kbRole.roleArn,
            knowledgeBaseConfiguration: {
                type: "VECTOR",
                vectorKnowledgeBaseConfiguration: {
                    embeddingModelArn,
                    embeddingModelConfiguration: {
                        bedrockEmbeddingModelConfiguration: {
                            dimensions: embeddingDimensions,
                            embeddingDataType: "FLOAT32",
                        },
                    },
                },
            },
            storageConfiguration: {
                type: "OPENSEARCH_SERVERLESS",
                opensearchServerlessConfiguration: {
                    collectionArn: collection.attrArn,
                    vectorIndexName: indexName,
                    fieldMapping: {
                        vectorField: "bedrock-knowledge-base-default-vector",
                        textField: "AMAZON_BEDROCK_TEXT_CHUNK",
                        metadataField: "AMAZON_BEDROCK_METADATA",
                    },
                },
            },
        });

        knowledgeBase.addDependency(vectorIndex);
        knowledgeBase.node.addDependency(waitForIndex);

        // ── Knowledge Base Data Source (S3) ──
        const dataSource = new cdk.aws_bedrock.CfnDataSource(this, "KBDataSource", {
            knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
            name: "product-catalog-s3",
            description: "Product catalog markdown documents",
            dataDeletionPolicy: "RETAIN",
            dataSourceConfiguration: {
                type: "S3",
                s3Configuration: {
                    bucketArn: props.knowledgeBaseBucket.bucketArn,
                    inclusionPrefixes: ["products/"],
                },
            },
            vectorIngestionConfiguration: {
                chunkingConfiguration: {
                    chunkingStrategy: "SEMANTIC",
                    semanticChunkingConfiguration: {
                        maxTokens: 300,
                        bufferSize: 0,
                        breakpointPercentileThreshold: 95,
                    },
                },
            },
        });

        this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
        this.knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;
        this.dataSourceId = dataSource.attrDataSourceId;

        // ── Outputs ──
        new cdk.CfnOutput(this, "KnowledgeBaseId", {
            value: knowledgeBase.attrKnowledgeBaseId,
        });
        new cdk.CfnOutput(this, "DataSourceId", {
            value: dataSource.attrDataSourceId,
        });
        new cdk.CfnOutput(this, "OpenSearchCollectionEndpoint", {
            value: collection.attrCollectionEndpoint,
        });
    }
}
