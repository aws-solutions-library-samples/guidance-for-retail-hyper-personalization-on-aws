import * as cdk from "aws-cdk-lib";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { ApiGatewayV2CloudFrontConstruct } from "./constructs/apigatewayv2-cloudfront-construct";
import { CognitoWebNativeConstruct } from "./constructs/cognito-web-native-construct";
import { SsmParameterReaderConstruct } from "./constructs/ssm-parameter-reader-construct";
import { LoggingBucketConstruct } from "./constructs/logging-bucket-construct";
import { CloudFrontS3WebSiteConstruct } from "./constructs/cloudfront-s3-website-construct";
import { WebsocketApiConstruct } from "./constructs/websocket-api-construct";
import { ProductDataConstruct } from "./constructs/product-data-construct";
import { KnowledgeBaseConstruct } from "./constructs/knowledge-base-construct";
import { PersonalizeConstruct } from "./constructs/personalize-construct";
import {
    aws_apigatewayv2_integrations as apigwv2int,
} from "aws-cdk-lib";

import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";

/**
 * Matches the geographic prefix on a cross-region (system-defined) Bedrock
 * inference profile ID, e.g. the "us." in "us.anthropic.claude-sonnet-4-...".
 */
const INFERENCE_PROFILE_PREFIX = /^(us|eu|apac|us-gov|global)\./;

/**
 * Builds the least-privilege resource list for `bedrock:InvokeModel*` given a
 * configured model ID.
 *
 * Two cases:
 *
 * 1. A plain foundation model ID ("anthropic.claude-sonnet-4-...") resolves to
 *    a single foundation-model ARN in the deployment Region.
 *
 * 2. A cross-region inference profile ID ("us.anthropic.claude-sonnet-4-...")
 *    resolves to the inference-profile ARN *and* the underlying foundation
 *    model. Bedrock requires both: "When you specify an inference profile in
 *    the Resource field ... you must also specify the foundation model in each
 *    Region associated with it."
 *    https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html
 *
 *    The Region segment of that foundation-model ARN is therefore a wildcard.
 *    The set of Regions a system-defined profile routes to is controlled by AWS
 *    and changes over time, so enumerating them here would silently break
 *    inference whenever AWS adds a Region to the profile. The permission is
 *    still tightly bound to one specific model — it is not `Resource: "*"` —
 *    and foundation-model ARNs are account-less, so this grants no access to
 *    any customer-owned resource. See "Security considerations" in the README.
 */
function bedrockInvokeModelResources(
    modelId: string,
    region: string,
    account: string,
    partition: string,
): string[] {
    const isInferenceProfile = INFERENCE_PROFILE_PREFIX.test(modelId);
    const baseModelId = modelId.replace(INFERENCE_PROFILE_PREFIX, "");

    if (!isInferenceProfile) {
        return [`arn:${partition}:bedrock:${region}::foundation-model/${baseModelId}`];
    }

    return [
        `arn:${partition}:bedrock:${region}:${account}:inference-profile/${modelId}`,
        `arn:${partition}:bedrock:*::foundation-model/${baseModelId}`,
    ];
}

export interface AppStackProps extends cdk.StackProps {
    readonly ssmWafArnParameterName: string;
    readonly ssmWafArnParameterRegion: string;
    /**
     * Bedrock model ID (or cross-region inference profile ID) used by the
     * AI Shopping Assistant agent. Supplied from CDK context so the model can
     * be swapped without code changes — see cdk.json.
     */
    readonly bedrockModelId: string;
    /**
     * Bedrock embedding model ID used by the Knowledge Base.
     */
    readonly embeddingModelId: string;
    /**
     * Vector dimensions produced by `embeddingModelId`. Must match the model,
     * as it is baked into the OpenSearch Serverless vector index.
     */
    readonly embeddingModelDimensions: number;
}

export class AppStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: AppStackProps) {
        super(scope, id, props);

        const webAppBuildPath = "../web-app/dist";

        // ──────────────────────────────────────────────────────────────────
        // Auth & Networking
        // ──────────────────────────────────────────────────────────────────

        const cognito = new CognitoWebNativeConstruct(this, "Cognito", props);

        const cfWafWebAcl = new SsmParameterReaderConstruct(
            this, "SsmWafParameter", {
                ssmParameterName: props.ssmWafArnParameterName,
                ssmParameterRegion: props.ssmWafArnParameterRegion,
            },
        ).getValue();

        const loggingBucket = new LoggingBucketConstruct(this, "LoggingBucket", {
            ssmPrefix: `/${this.stackName}`,
        });

        const api = new ApiGatewayV2CloudFrontConstruct(this, "Api", {
            userPool: cognito.userPool,
            userPoolClient: cognito.webClientUserPool,
        });

        const website = new CloudFrontS3WebSiteConstruct(this, "WebApp", {
            webAclArn: cfWafWebAcl,
            loggingBucket: loggingBucket.loggingBucket,
            loggingPrefix: "webapp",
        });

        api.addBehaviorToCloudFrontDistribution(website.cloudFrontDistribution);

        // ──────────────────────────────────────────────────────────────────
        // Product Data Layer
        // ──────────────────────────────────────────────────────────────────

        const productData = new ProductDataConstruct(this, "ProductData", {
            stackName: this.stackName,
        });

        // Add CloudFront behavior for product images from S3
        website.cloudFrontDistribution.addBehavior(
            "/products/*.png",
            cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
                productData.imagesBucket,
                {
                    originAccessLevels: [cdk.aws_cloudfront.AccessLevel.READ],
                },
            ),
            {
                cachePolicy: new cdk.aws_cloudfront.CachePolicy(this, "ImagesCachePolicy", {
                    defaultTtl: cdk.Duration.days(30),
                    maxTtl: cdk.Duration.days(365),
                    enableAcceptEncodingGzip: true,
                }),
                viewerProtocolPolicy: cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
        );

        // ──────────────────────────────────────────────────────────────────
        // Knowledge Base (Bedrock + OpenSearch Serverless)
        // ──────────────────────────────────────────────────────────────────

        const knowledgeBase = new KnowledgeBaseConstruct(this, "KnowledgeBase", {
            stackName: this.stackName,
            knowledgeBaseBucket: productData.knowledgeBaseBucket,
            embeddingModelId: props.embeddingModelId,
            embeddingModelDimensions: props.embeddingModelDimensions,
        });

        // ──────────────────────────────────────────────────────────────────
        // Amazon Personalize
        // ──────────────────────────────────────────────────────────────────

        const personalize = new PersonalizeConstruct(this, "Personalize", {
            stackName: this.stackName,
            personalizeBucket: productData.personalizeBucket,
        });

        // The campaign and event tracker are created post-deploy (model training
        // takes 1-2 hours, so they are not CloudFormation resources), but their
        // names are deterministic. IAM policies can reference an ARN before the
        // resource exists, which lets us scope permissions to exactly these two
        // resources instead of using a wildcard.
        const personalizeCampaignArn =
            `arn:${this.partition}:personalize:${this.region}:${this.account}:campaign/${this.stackName}-recommendations`;

        // scripts/setup_personalize.py creates the event tracker under the stack
        // name prefix. The exact suffix is not known at synth time, so this is
        // scoped to the stack's own trackers rather than all of Personalize.
        const personalizeEventTrackerArn =
            `arn:${this.partition}:personalize:${this.region}:${this.account}:event-tracker/${this.stackName}-*`;

        // ──────────────────────────────────────────────────────────────────
        // AgentCore Runtime
        // ──────────────────────────────────────────────────────────────────

        const agentCoreImage = new cdk.aws_ecr_assets.DockerImageAsset(this, "AgentCoreImage", {
            directory: "../agent",
        });

        const agentRuntime = new agentcore.Runtime(this, "AgentRuntime", {
            runtimeName: `${this.stackName.toLowerCase()}_agent`.replace(/-/g, "_"),
            agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromEcrRepository(
                agentCoreImage.repository,
                agentCoreImage.imageTag,
            ),
            description: "AI Shopping Assistant agent runtime",
            environmentVariables: {
                AWS_REGION: this.region,
                BEDROCK_MODEL_ID: props.bedrockModelId,
                KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
                PRODUCT_TABLE_NAME: productData.productTable.tableName,
                PERSONALIZE_DATASET_GROUP_ARN: personalize.datasetGroupArn,
                PERSONALIZE_CAMPAIGN_ARN: personalizeCampaignArn,
            },
        });

        // Grant Bedrock model invocation, scoped to the configured model only.
        // See bedrockInvokeModelResources() above for why the foundation-model
        // ARN carries a Region wildcard when an inference profile is used.
        agentRuntime.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            sid: "InvokeConfiguredBedrockModel",
            actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources: bedrockInvokeModelResources(
                props.bedrockModelId,
                this.region,
                this.account,
                this.partition,
            ),
        }));

        // When the configured model is a cross-region inference profile, the
        // foundation-model ARN must carry a Region wildcard (see
        // bedrockInvokeModelResources above). Suppress AwsSolutions-IAM5 for
        // that one ARN only, with the reason recorded, rather than blanket-
        // suppressing wildcard findings on this policy.
        if (INFERENCE_PROFILE_PREFIX.test(props.bedrockModelId)) {
            const baseModelId = props.bedrockModelId.replace(INFERENCE_PROFILE_PREFIX, "");
            NagSuppressions.addResourceSuppressionsByPath(
                this,
                `/${this.stackName}/AgentRuntime/ExecutionRole/DefaultPolicy/Resource`,
                [
                    {
                        id: "AwsSolutions-IAM5",
                        reason:
                            "bedrock_model_id is configured as a cross-region inference profile " +
                            `("${props.bedrockModelId}"). Bedrock requires bedrock:InvokeModel on both the ` +
                            "inference profile and the underlying foundation model in every Region the " +
                            "profile routes to. AWS controls that Region set and changes it over time, so " +
                            "the Region segment is wildcarded rather than enumerated, which would break " +
                            "inference whenever AWS adds a Region. The permission remains scoped to this " +
                            "one model, and foundation-model ARNs are account-less, so no customer-owned " +
                            "resource is in scope. To remove this wildcard, set bedrock_model_id to a " +
                            "single-Region foundation model ID.",
                        appliesTo: [
                            `Resource::arn:${this.partition}:bedrock:*::foundation-model/${baseModelId}`,
                        ],
                    },
                ],
            );
        }

        // Grant Knowledge Base retrieval
        agentRuntime.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
            resources: [knowledgeBase.knowledgeBaseArn],
        }));

        // Grant DynamoDB read access for product lookups
        productData.productTable.grantReadData(agentRuntime);

        // Grant Personalize read access for recommendations, scoped to this
        // stack's campaign. The agent's get_recommendations tool calls only
        // GetRecommendations — GetPersonalizedRanking, DescribeCampaign and
        // ListCampaigns were previously granted but never used, so they are
        // no longer requested.
        agentRuntime.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            sid: "GetPersonalizeRecommendations",
            actions: ["personalize:GetRecommendations"],
            resources: [personalizeCampaignArn],
        }));

        // ──────────────────────────────────────────────────────────────────
        // Shared Lambda Asset (js-lambdas)
        // ──────────────────────────────────────────────────────────────────

        const jsLambdaAsset = cdk.aws_lambda.Code.fromAsset("../js-lambdas", {
            bundling: {
                image: cdk.aws_lambda.Runtime.NODEJS_22_X.bundlingImage,
                command: [
                    "bash", "-c",
                    "export npm_config_cache=/tmp/.npm && rm -rf node_modules && npm install --omit=dev && cp -r . /asset-output/",
                ],
                local: {
                    tryBundle(outputDir: string) {
                        const { execSync } = require("child_process");
                        execSync("npm install --omit=dev", { cwd: "../js-lambdas", stdio: "inherit" });
                        execSync(`cp -r ../js-lambdas/. ${outputDir}`, { stdio: "inherit" });
                        return true;
                    },
                },
            },
            exclude: ["coverage", "test"],
        });

        // ──────────────────────────────────────────────────────────────────
        // Recommendations API (HTTP API endpoint)
        // ──────────────────────────────────────────────────────────────────

        const recommendationsFnRole = new cdk.aws_iam.Role(this, "LambdaExecutionRole-recommendations", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
            ],
        });

        // Grant Personalize and DynamoDB access, scoped to this stack's campaign.
        // get-recommendations.js calls only GetRecommendations (it passes itemId
        // to the same API for "similar items"), so GetPersonalizedRanking is not
        // requested.
        recommendationsFnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            sid: "GetPersonalizeRecommendations",
            actions: ["personalize:GetRecommendations"],
            resources: [personalizeCampaignArn],
        }));
        productData.productTable.grantReadData(recommendationsFnRole);

        const recommendationsFn = new cdk.aws_lambda.Function(this, "RecommendationsFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
            handler: "src/api/recommendations/get-recommendations.handler",
            code: jsLambdaAsset,
            role: recommendationsFnRole,
            logGroup: new cdk.aws_logs.LogGroup(this, "RecommendationsLogGroup", {
                retention: cdk.aws_logs.RetentionDays.TEN_YEARS,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            memorySize: 256,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            timeout: Duration.seconds(30),
            tracing: cdk.aws_lambda.Tracing.ACTIVE,
            environment: {
                PERSONALIZE_CAMPAIGN_ARN: `arn:aws:personalize:${this.region}:${this.account}:campaign/${this.stackName}-recommendations`,
                PRODUCT_TABLE_NAME: productData.productTable.tableName,
            },
        });

        // Add route to HTTP API
        api.apiGatewayV2.addRoutes({
            path: "/api/recommendations",
            methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
            integration: new apigwv2Integrations.HttpLambdaIntegration(
                "RecommendationsIntegration",
                recommendationsFn,
            ),
        });

        // ──────────────────────────────────────────────────────────────────
        // Events API (record user interactions for Personalize)
        // ──────────────────────────────────────────────────────────────────

        const eventsFnRole = new cdk.aws_iam.Role(this, "LambdaExecutionRole-events", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
            ],
        });

        // PutEvents is authorized against the event tracker, not the campaign.
        eventsFnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            sid: "PutPersonalizeEvents",
            actions: ["personalize:PutEvents"],
            resources: [personalizeEventTrackerArn],
        }));

        const eventsFn = new cdk.aws_lambda.Function(this, "EventsFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
            handler: "src/api/events/record-event.handler",
            code: jsLambdaAsset,
            role: eventsFnRole,
            logGroup: new cdk.aws_logs.LogGroup(this, "EventsLogGroup", {
                retention: cdk.aws_logs.RetentionDays.TEN_YEARS,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            memorySize: 256,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            timeout: Duration.seconds(10),
            tracing: cdk.aws_lambda.Tracing.ACTIVE,
            environment: {
                PERSONALIZE_TRACKING_ID: "", // Set after creating event tracker post-deploy
            },
        });

        api.apiGatewayV2.addRoutes({
            path: "/api/events",
            methods: [cdk.aws_apigatewayv2.HttpMethod.POST],
            integration: new apigwv2Integrations.HttpLambdaIntegration(
                "EventsIntegration",
                eventsFn,
            ),
        });

        // ──────────────────────────────────────────────────────────────────
        // WebSocket API
        // ──────────────────────────────────────────────────────────────────

        const wsApi = new WebsocketApiConstruct(this, "WsApi", {
            userPool: cognito.userPool,
            webClientId: cognito.webClientId,
        });

        // KMS key for session encryption
        const sessionKmsKey = new cdk.aws_kms.Key(this, "SessionKmsKey", {
            description: "KMS key for encrypting agent session IDs",
            enableKeyRotation: true,
        });

        new cdk.aws_kms.Alias(this, "SessionKmsKeyAlias", {
            aliasName: `alias/${this.stackName}-agentcore-sessions`,
            targetKey: sessionKmsKey,
        });

        // Chat Lambda

        const chatFnRole = new cdk.aws_iam.Role(this, "LambdaExecutionRole-ws-chat", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
            ],
        });

        // Grant WebSocket management, AgentCore invoke, and KMS permissions
        chatFnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["execute-api:ManageConnections"],
            resources: [
                `${wsApi.API_ARN_PREFIX}:${wsApi.api.apiId}/${wsApi.stage.stageName}/*`,
            ],
        }));
        // Scope bedrock-agentcore:InvokeAgentRuntime to this runtime only.
        //
        // NOTE: we do not use agentRuntime.grantInvokeRuntime() here. That helper
        // grants only the bare runtime ARN, but AgentCore authorizes the call
        // against the runtime *endpoint* sub-resource — an unqualified
        // InvokeAgentRuntime resolves to the DEFAULT endpoint, producing
        // AccessDeniedException on
        // .../runtime/<id>/runtime-endpoint/DEFAULT. Both ARNs are granted below,
        // fully qualified, so no wildcard is required.
        //
        // InvokeAgentRuntimeForUser is deliberately not granted: the chat handler
        // does not send the X-Amzn-Bedrock-AgentCore-Runtime-User-Id header.
        chatFnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            sid: "InvokeThisAgentRuntime",
            actions: ["bedrock-agentcore:InvokeAgentRuntime"],
            resources: [
                agentRuntime.agentRuntimeArn,
                `${agentRuntime.agentRuntimeArn}/runtime-endpoint/DEFAULT`,
            ],
        }));

        chatFnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["kms:Encrypt", "kms:Decrypt"],
            resources: [sessionKmsKey.keyArn],
        }));

        const chatFn = new cdk.aws_lambda.Function(this, "wsChatFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
            handler: "src/api/app-ws/wss-api-chat.handler",
            code: jsLambdaAsset,
            role: chatFnRole,
            logGroup: new cdk.aws_logs.LogGroup(this, "wsChatLogGroup", {
                retention: cdk.aws_logs.RetentionDays.TEN_YEARS,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            memorySize: 1024,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            timeout: Duration.minutes(10),
            tracing: cdk.aws_lambda.Tracing.ACTIVE,
            environment: {
                AGENTCORE_RUNTIME_ARN: agentRuntime.agentRuntimeArn,
                AGENTCORE_REGION: this.region,
                SESSION_KMS_KEY_ID: sessionKmsKey.keyId,
            },
        });

        // Add chat route to WebSocket API
        wsApi.api.addRoute("chat", {
            integration: new apigwv2int.WebSocketLambdaIntegration("ChatIntegration", chatFn),
        });

        chatFn.grantInvoke(new cdk.aws_iam.ServicePrincipal("apigateway.amazonaws.com"));

        // ──────────────────────────────────────────────────────────────────
        // Deploy Website
        // ──────────────────────────────────────────────────────────────────

        const wsUrl = `wss://${wsApi.api.apiId}.execute-api.${this.region}.amazonaws.com/${wsApi.stage.stageName}`;

        website.deployWebsite(webAppBuildPath, [
            cdk.aws_s3_deployment.Source.jsonData("config.json", {
                Auth: {
                    Cognito: {
                        allowGuestAccess: false,
                        region: this.region,
                        userPoolId: cognito.userPool.userPoolId,
                        userPoolClientId: cognito.webClientId,
                        identityPoolId: cognito.identityPoolId,
                    },
                },
                API: {
                    REST: {
                        api: {
                            endpoint: `https://${website.cloudFrontDistribution.distributionDomainName}/api`,
                            region: this.region,
                        },
                    },
                },
                WebSocket: {
                    url: wsUrl,
                },
            }),
        ]);

        // ──────────────────────────────────────────────────────────────────
        // Outputs
        // ──────────────────────────────────────────────────────────────────

        new cdk.CfnOutput(this, "WebSocketApiUrl", {
            value: wsUrl,
            description: "WebSocket API URL",
        });
        new cdk.CfnOutput(this, "KnowledgeBaseId", {
            value: knowledgeBase.knowledgeBaseId,
            description: "Bedrock Knowledge Base ID for product search",
        });
        new cdk.CfnOutput(this, "PersonalizeDatasetGroupArn", {
            value: personalize.datasetGroupArn,
            description: "Personalize Dataset Group ARN",
        });
    }
}
