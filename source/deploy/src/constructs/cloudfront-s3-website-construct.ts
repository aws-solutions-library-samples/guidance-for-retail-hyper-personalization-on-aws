/**
 * Copyright 2024 Amazon.com, Inc. and its affiliates. All Rights Reserved.
 *
 * Licensed under the Amazon Software License (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *   http://aws.amazon.com/asl/
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface CloudFrontS3WebSiteConstructProps extends cdk.StackProps {
    /**
     * The path to the build directory of the web site, relative to the project root
     * ex: "./app/dist"
     * If provided, the bucket deployment will be created automatically in the constructor
     */
    readonly webSiteBuildPath?: string;

    /**
     * The Arn of the WafV2 WebAcl.
     */
    readonly webAclArn?: string;

    readonly loggingBucket: cdk.aws_s3.IBucket;
    readonly loggingPrefix: string;

    /**
     * Additional sources to include in the bucket deployment
     * Only used if webSiteBuildPath is provided
     */
    additionalSources?: cdk.aws_s3_deployment.ISource[];

    /**
     * Memory limit for the bucket deployment Lambda function
     * Only used if webSiteBuildPath is provided
     * @default 1024
     */
    readonly bucketDeploymentMemoryLimit?: number;

    /**
     * Enable SPA URL rewrites using a CloudFront Function instead of
     * the 404→index.html error response hack.
     *
     * When enabled, requests without a file extension (no dot in the last
     * path segment) are rewritten to /index.html, allowing client-side
     * routing to handle them. Requests with file extensions (e.g. .js, .css,
     * .png) pass through unmodified to S3.
     *
     * @default false - uses the legacy 404→index.html error response
     */
    readonly enableSpaUrlRewrites?: boolean;
}

const defaultProps: Partial<CloudFrontS3WebSiteConstructProps> = {};

/**
 * Deploys a CloudFront Distribution pointing to an S3 bucket containing the deployed web application {webSiteBuildPath}.
 * Creates:
 * - S3 bucket
 * - CloudFrontDistribution
 * - OriginAccessIdentity
 *
 * On redeployment, will automatically invalidate the CloudFront distribution cache
 */
export class CloudFrontS3WebSiteConstruct extends Construct {
    /**
     * The cloud front distribution to attach additional behaviors like `/api`
     */
    public cloudFrontDistribution: cdk.aws_cloudfront.Distribution;

    /**
     * The bucket where the frontend assets are stored
     */
    public siteBucket: cdk.aws_s3.Bucket;

    /**
     * The bucket deployment that deploys the website content to the S3 bucket
     * This will be undefined if no deployment has been created yet
     */
    public bucketDeployment?: cdk.aws_s3_deployment.BucketDeployment;

    constructor(
        parent: Construct,
        name: string,
        props: CloudFrontS3WebSiteConstructProps,
    ) {
        super(parent, name);

        props = { ...defaultProps, ...props };

        // When using Distribution, do not set the s3 bucket website documents
        // if these are set then the distribution origin is configured for HTTP communication with the
        // s3 bucket and won't configure the cloudformation correctly.
        this.siteBucket = new cdk.aws_s3.Bucket(this, "WebApp", {
            encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
            autoDeleteObjects: true,
            blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            enforceSSL: true,
            serverAccessLogsBucket: props.loggingBucket,
            serverAccessLogsPrefix: props.loggingPrefix + "/bucket",
        });

        // https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-server-access-logging.html
        const s3LoggingBucketPolicy = new cdk.aws_iam.PolicyStatement({
            effect: cdk.aws_iam.Effect.ALLOW,
            principals: [
                new cdk.aws_iam.ServicePrincipal("logging.s3.amazonaws.com"),
            ],
            actions: ["s3:PutObject"],
            resources: [`${props.loggingBucket.bucketArn}/*`],
            conditions: {
                StringEquals: {
                    "s3:x-amz-acl": "bucket-owner-full-control",
                    "aws:SourceAccount": cdk.Stack.of(this).account,
                },
                ArnLike: {
                    "aws:SourceArn": this.siteBucket.bucketArn,
                },
            },
        });
        props.loggingBucket.addToResourcePolicy(s3LoggingBucketPolicy);

        this.siteBucket.addToResourcePolicy(
            new cdk.aws_iam.PolicyStatement({
                sid: "EnforceTLS",
                effect: cdk.aws_iam.Effect.DENY,
                principals: [new cdk.aws_iam.AnyPrincipal()],
                actions: ["s3:*"],
                resources: [
                    this.siteBucket.bucketArn,
                    this.siteBucket.bucketArn + "/*",
                ],
                conditions: { Bool: { "aws:SecureTransport": "false" } },
            }),
        );

        const s3origin =
            cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
                this.siteBucket,
                {
                    originAccessLevels: [cdk.aws_cloudfront.AccessLevel.READ],
                },
            );

        let logFilePrefix = props.loggingPrefix + "/cloudfront";
        if (logFilePrefix.startsWith("/")) {
            logFilePrefix = logFilePrefix.substring(1);
        }

        // When SPA rewrites are enabled, create a CloudFront Function that
        // rewrites extensionless URIs to /index.html so client-side routing works.
        let spaRewriteFunction: cdk.aws_cloudfront.Function | undefined;
        if (props.enableSpaUrlRewrites) {
            spaRewriteFunction = new cdk.aws_cloudfront.Function(
                this,
                "SpaUrlRewrite",
                {
                    code: cdk.aws_cloudfront.FunctionCode.fromInline(`
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    // Don't rewrite /api paths — they have their own CloudFront behavior
    // but guard here for safety
    if (uri.indexOf('/api') === 0) {
        return request;
    }
    // If the URI has a file extension (dot in the last path segment), pass through
    var lastSegment = uri.split('/').pop();
    if (lastSegment && lastSegment.indexOf('.') > -1) {
        return request;
    }
    // Rewrite extensionless paths to /index.html for SPA client-side routing
    request.uri = '/index.html';
    return request;
}
`),
                    runtime: cdk.aws_cloudfront.FunctionRuntime.JS_2_0,
                    comment:
                        "Rewrites extensionless URIs to /index.html for SPA routing",
                },
            );
        }

        const cloudFrontDistribution = new cdk.aws_cloudfront.Distribution(
            this,
            "WebAppDistribution",
            {
                defaultBehavior: {
                    origin: s3origin,
                    cachePolicy: new cdk.aws_cloudfront.CachePolicy(
                        this,
                        "CachePolicy",
                        {
                            defaultTtl: cdk.Duration.hours(1),
                        },
                    ),
                    allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy:
                        cdk.aws_cloudfront.ViewerProtocolPolicy
                            .REDIRECT_TO_HTTPS,
                    ...(spaRewriteFunction && {
                        functionAssociations: [
                            {
                                function: spaRewriteFunction,
                                eventType:
                                    cdk.aws_cloudfront.FunctionEventType
                                        .VIEWER_REQUEST,
                            },
                        ],
                    }),
                },
                // Legacy SPA handling: return index.html for 404s.
                // Skipped when enableSpaUrlRewrites is true since the
                // CloudFront Function handles routing instead.
                ...(!props.enableSpaUrlRewrites && {
                    errorResponses: [
                        {
                            httpStatus: 404,
                            ttl: cdk.Duration.hours(0),
                            responseHttpStatus: 200,
                            responsePagePath: "/index.html",
                        },
                    ],
                }),
                logBucket: props.loggingBucket,
                logIncludesCookies: false,
                logFilePrefix,
                defaultRootObject: "index.html",
                webAclId: props.webAclArn,
                minimumProtocolVersion:
                    cdk.aws_cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021, // Required by security
            },
        );

        // export any cf outputs
        new cdk.CfnOutput(this, "SiteBucket", {
            value: this.siteBucket.bucketName,
        });
        new cdk.CfnOutput(this, "CloudFrontDistributionId", {
            value: cloudFrontDistribution.distributionId,
        });
        new cdk.CfnOutput(this, "CloudFrontDistributionDomainName", {
            value: cloudFrontDistribution.distributionDomainName,
        });
        new cdk.CfnOutput(this, "CloudFrontDistributionUrl", {
            value: `https://${cloudFrontDistribution.distributionDomainName}`,
        });

        // assign public properties
        this.cloudFrontDistribution = cloudFrontDistribution;

        // If webSiteBuildPath is provided, create the bucket deployment automatically
        if (props.webSiteBuildPath) {
            this.deployWebsite(
                props.webSiteBuildPath,
                props.additionalSources,
                props.bucketDeploymentMemoryLimit,
            );
        }
    }

    /**
     * Deploys website content to the S3 bucket and sets up CloudFront invalidation
     * @param webSiteBuildPath The path to the build directory of the web site, relative to the project root
     * @param additionalSources Additional sources to include in the bucket deployment
     * @param memoryLimitMiB Memory limit for the bucket deployment Lambda function (default: 1024)
     * @returns The created bucket deployment
     */
    public deployWebsite(
        webSiteBuildPath: string,
        additionalSources?: cdk.aws_s3_deployment.ISource[],
        memoryLimitMiB: number = 1024,
    ): cdk.aws_s3_deployment.BucketDeployment {
        const stack = cdk.Stack.of(this);

        // Create the bucket deployment
        const bucketDeployment = new cdk.aws_s3_deployment.BucketDeployment(
            this,
            "DeployWithInvalidation",
            {
                sources: [
                    cdk.aws_s3_deployment.Source.asset(webSiteBuildPath),
                    ...(additionalSources ?? []),
                ], // from root directory
                destinationBucket: this.siteBucket,
                distribution: this.cloudFrontDistribution, // this assignment, on redeploy, will automatically invalidate the cloudfront cache
                distributionPaths: ["/*"],
                // default of 128 isn't large enough for larger website deployments. More memory doesn't improve the performance.
                // You want just enough memory to guarantee deployment
                memoryLimit: memoryLimitMiB,
            },
        );

        // Add the necessary suppressions for CDK-NAG
        NagSuppressions.addResourceSuppressionsByPath(
            stack,
            // This looks brittle but it's not––the long ID (869...56C) is part of the CDK source code
            `/${stack.node.id}/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C${memoryLimitMiB}MiB/ServiceRole/DefaultPolicy/Resource`,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Bucket Deployment uses several IAM wildcards that are necessary",
                },
            ],
        );

        // Store the bucket deployment in the class property
        this.bucketDeployment = bucketDeployment;

        return bucketDeployment;
    }

    /**
     * Builds and deploys a website from source code to the S3 bucket with CloudFront invalidation.
     * This method securely builds the web application using npm and then deploys it.
     *
     * @param webAppSourcePath The path to the web application source directory (default: "../../../web-app" relative to __dirname)
     * @param additionalSources Additional sources to include in the bucket deployment
     * @param memoryLimitMiB Memory limit for the bucket deployment Lambda function (default: 1024)
     * @param buildCommand The npm build command to execute (default: "npm run build")
     * @returns The created bucket deployment
     * @throws Error if the build process fails or paths are invalid
     */
    public buildAndDeployWebsite(
        webAppSourcePath: string = path.join(__dirname, "../../../web-app"),
        additionalSources?: cdk.aws_s3_deployment.ISource[],
        memoryLimitMiB: number = 1024,
        buildCommand: string = "npm run build",
    ): cdk.aws_s3_deployment.BucketDeployment {
        // Validate and resolve the source path
        const resolvedSourcePath = path.resolve(webAppSourcePath);

        // Validate that the source directory exists
        if (!fs.existsSync(resolvedSourcePath)) {
            throw new Error(
                `Web app source directory does not exist: ${resolvedSourcePath}`,
            );
        }

        // Validate that package.json exists in the source directory
        const packageJsonPath = path.join(resolvedSourcePath, "package.json");
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(
                `package.json not found in source directory: ${resolvedSourcePath}`,
            );
        }

        // Create the S3 deployment source with secure bundling
        const buildSource = cdk.aws_s3_deployment.Source.asset(
            resolvedSourcePath,
            {
                assetHashType: cdk.AssetHashType.OUTPUT,
                bundling: {
                    image: cdk.DockerImage.fromRegistry("node:lts"),
                    command: [],
                    local: {
                        tryBundle(outputDir: string): boolean {
                            try {
                                // Validate npm is available
                                const npmVersionResult = spawnSync(
                                    "npm",
                                    ["--version"],
                                    {
                                        stdio: "pipe",
                                    },
                                );

                                if (npmVersionResult.error) {
                                    console.warn(
                                        "npm not available, falling back to Docker bundling",
                                    );
                                    return false;
                                }

                                // Sanitize and validate the output directory
                                const sanitizedOutputDir =
                                    path.resolve(outputDir);

                                // Ensure output directory is safe (no directory traversal)
                                if (
                                    !sanitizedOutputDir.startsWith(
                                        path.resolve(outputDir),
                                    )
                                ) {
                                    throw new Error(
                                        "Invalid output directory path detected",
                                    );
                                }

                                console.log(
                                    `Building web app from: ${resolvedSourcePath}`,
                                );
                                console.log(
                                    `Output directory: ${sanitizedOutputDir}`,
                                );

                                // Install dependencies securely
                                const installResult = spawnSync("npm", ["ci"], {
                                    cwd: resolvedSourcePath,
                                    stdio: "inherit",
                                });

                                if (
                                    installResult.error ||
                                    installResult.status !== 0
                                ) {
                                    throw new Error(
                                        `npm ci failed: ${installResult.error?.message || "Unknown error"}`,
                                    );
                                }

                                // Parse and validate build command
                                const buildArgs = buildCommand
                                    .split(/\s+/)
                                    .filter((arg) => arg.length > 0);
                                if (buildArgs.length === 0) {
                                    throw new Error(
                                        "Build command cannot be empty",
                                    );
                                }

                                // Add build output configuration securely
                                const fullBuildArgs = [
                                    ...buildArgs,
                                    "--",
                                    "--emptyOutDir",
                                    `--outDir=${sanitizedOutputDir}`,
                                ];

                                // Execute build command securely
                                const buildResult = spawnSync(
                                    "npm",
                                    fullBuildArgs,
                                    {
                                        cwd: resolvedSourcePath,
                                        stdio: "inherit",
                                    },
                                );

                                if (
                                    buildResult.error ||
                                    buildResult.status !== 0
                                ) {
                                    throw new Error(
                                        `Build command failed: ${buildResult.error?.message || "Build process returned non-zero exit code"}`,
                                    );
                                }

                                console.log(
                                    "Web app build completed successfully",
                                );
                                return true;
                            } catch (error) {
                                const errorMessage =
                                    error instanceof Error
                                        ? error.message
                                        : String(error);
                                throw new Error(
                                    `Failed to build web application: ${errorMessage}`,
                                );
                            }
                        },
                    },
                },
            },
        );

        // Create the bucket deployment directly since we have a custom source
        const stack = cdk.Stack.of(this);

        const bucketDeployment = new cdk.aws_s3_deployment.BucketDeployment(
            this,
            "BuildAndDeployWithInvalidation",
            {
                sources: [buildSource, ...(additionalSources ?? [])],
                destinationBucket: this.siteBucket,
                distribution: this.cloudFrontDistribution,
                distributionPaths: ["/*"],
                memoryLimit: memoryLimitMiB,
            },
        );

        // Add the necessary suppressions for CDK-NAG
        NagSuppressions.addResourceSuppressionsByPath(
            stack,
            `/${stack.node.id}/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C${memoryLimitMiB}MiB/ServiceRole/DefaultPolicy/Resource`,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Bucket Deployment uses several IAM wildcards that are necessary",
                },
            ],
        );

        // Store the bucket deployment in the class property
        this.bucketDeployment = bucketDeployment;

        return bucketDeployment;
    }
}
