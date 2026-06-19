import * as cdk from "aws-cdk-lib";
import {
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_authorizers as apigwv2auth,
    aws_apigatewayv2_integrations as apigwv2int,
    Duration,
    RemovalPolicy,
    Stack,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface WebsocketApiConstructProps extends cdk.StackProps {
    userPool: cdk.aws_cognito.UserPool;
    webClientId: string;
}

export class WebsocketApiConstruct extends Construct {
    readonly api: apigwv2.WebSocketApi;
    readonly stage: apigwv2.WebSocketStage;
    readonly authorizer: apigwv2auth.WebSocketLambdaAuthorizer;
    readonly API_ARN_PREFIX: string;
    readonly API_ARN: string;

    constructor(parent: Construct, name: string, props: WebsocketApiConstructProps) {
        super(parent, name);

        const { userPool, webClientId } = props;

        const sessionTrackingTable = new cdk.aws_dynamodb.Table(this, "wsConnectionTrackingTable", {
            pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
            contributorInsightsSpecification: { enabled: true },
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            partitionKey: { name: "type", type: cdk.aws_dynamodb.AttributeType.STRING },
            sortKey: { name: "id", type: cdk.aws_dynamodb.AttributeType.STRING },
            encryption: cdk.aws_dynamodb.TableEncryption.AWS_MANAGED,
            removalPolicy: RemovalPolicy.DESTROY,
            timeToLiveAttribute: "ttl",
        });

        const jsJwtLayer = new cdk.aws_lambda.LayerVersion(this, "jsJwtLayer", {
            code: cdk.aws_lambda.Code.fromAsset("../js-layers/jwt-layer/build/jwt-layer.zip"),
            compatibleRuntimes: [cdk.aws_lambda.Runtime.NODEJS_22_X],
            description: "JWT and JWKS libraries",
        });

        jsJwtLayer.addPermission("jsJwtLayerPermission", {
            accountId: Stack.of(this).account,
        });

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

        // Authorizer Lambda
        const authorizerFnRole = new cdk.aws_iam.Role(this, "LambdaExecutionRole-ws-authorizer", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
            ],
        });
        authorizerFnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["cognito-idp:GetUser"],
            resources: [userPool.userPoolArn],
        }));

        const authorizerFn = new cdk.aws_lambda.Function(this, "wsAuthorizerFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
            handler: "src/api/app-ws/wss-api-auth.handler",
            code: jsLambdaAsset,
            role: authorizerFnRole,
            logGroup: new cdk.aws_logs.LogGroup(this, "wsAuthLogGroup", {
                retention: cdk.aws_logs.RetentionDays.TEN_YEARS,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            memorySize: 128,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            timeout: Duration.seconds(10),
            layers: [jsJwtLayer],
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                CLIENT_ID: webClientId,
            },
        });

        // Connect Lambda
        const connectFnRole = new cdk.aws_iam.Role(this, "LambdaExecutionRole-ws-connect", {
            assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
            ],
        });
        connectFnRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["dynamodb:PutItem"],
            resources: [sessionTrackingTable.tableArn],
        }));

        const connectFn = new cdk.aws_lambda.Function(this, "wsConnectFunction", {
            runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
            handler: "src/api/app-ws/wss-api-connect.handler",
            code: jsLambdaAsset,
            role: connectFnRole,
            logGroup: new cdk.aws_logs.LogGroup(this, "wsConnectLogGroup", {
                retention: cdk.aws_logs.RetentionDays.TEN_YEARS,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            memorySize: 128,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            timeout: Duration.seconds(10),
            environment: {
                TABLE_NAME: sessionTrackingTable.tableName,
            },
        });

        // WebSocket API
        this.API_ARN_PREFIX = `arn:aws:execute-api:${Stack.of(this).region}:${Stack.of(this).account}`;

        this.authorizer = new apigwv2auth.WebSocketLambdaAuthorizer(
            "WebSocketsAuthorizer",
            authorizerFn,
            { identitySource: ["route.request.querystring.token"] },
        );

        const api = new apigwv2.WebSocketApi(this, "WebSocketsApi", {
            apiName: "wsApi",
            description: "WebSocket API for chat",
            connectRouteOptions: {
                authorizer: this.authorizer,
                integration: new apigwv2int.WebSocketLambdaIntegration("ConnectIntegration", connectFn),
            },
        });

        this.stage = new apigwv2.WebSocketStage(this, "WebSocketsApiStage", {
            webSocketApi: api,
            stageName: "ws",
            autoDeploy: true,
        });

        this.api = api;
        this.API_ARN = `${this.API_ARN_PREFIX}:${api.apiId}/*`;
    }
}
