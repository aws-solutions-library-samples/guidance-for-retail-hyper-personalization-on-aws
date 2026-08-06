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

import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { AppStack } from "./app-stack";
import { suppressCdkNagRules } from "./constructs/cdk-nag-suppressions";
import { CfWafStack } from "./cf-waf-stack";

const app = new cdk.App();

const stackName =
    process.env.STACK_NAME ||
    app.node.tryGetContext("stack_name") ||
    "prototype";
const account =
    app.node.tryGetContext("account") ||
    process.env.CDK_DEPLOY_ACCOUNT ||
    process.env.CDK_DEFAULT_ACCOUNT;
const region =
    app.node.tryGetContext("region") ||
    process.env.CDK_DEPLOY_REGION ||
    process.env.CDK_DEFAULT_REGION;

/**
 * Reads a required value from CDK context (cdk.json, or `-c key=value` on the
 * CLI) and fails the synth if it is missing or blank.
 *
 * Model IDs are configuration rather than source code: foundation models are
 * deprecated and replaced over time, so customers need to be able to swap them
 * without editing the application. Failing loudly here means a missing or
 * mistyped value surfaces at synth time with an actionable message, instead of
 * as a runtime AccessDenied or ValidationException after deployment.
 */
function requireContext(key: string): string {
    const value = app.node.tryGetContext(key);
    if (value === undefined || value === null || `${value}`.trim() === "") {
        throw new Error(
            `Missing required CDK context value "${key}". ` +
            `Set it in source/deploy/cdk.json or pass -c ${key}=<value> on the CDK CLI.`,
        );
    }
    return `${value}`;
}

// Bedrock model configuration — see the "_comment_models" note in cdk.json.
const bedrockModelId = requireContext("bedrock_model_id");
const embeddingModelId = requireContext("embedding_model_id");

const embeddingModelDimensions = Number(requireContext("embedding_model_dimensions"));
if (!Number.isInteger(embeddingModelDimensions) || embeddingModelDimensions <= 0) {
    throw new Error(
        "CDK context value \"embedding_model_dimensions\" must be a positive integer, " +
        `got "${app.node.tryGetContext("embedding_model_dimensions")}".`,
    );
}

// Deploy Waf for CloudFront in us-east-1
const cfWafStackName = stackName + "-waf";

(() => {
    const cfWafStack = new CfWafStack(app, cfWafStackName, {
        env: {
            account: account,
            region: "us-east-1",
        },
        stackName: cfWafStackName,
    });

    // Deploy App Stack
    const appStack = new AppStack(app, stackName, {
        env: {
            account: account,
            region: region,
        },
        stackName: stackName,
        ssmWafArnParameterName: cfWafStack.ssmWafArnParameterName,
        ssmWafArnParameterRegion: cfWafStack.region,
        bedrockModelId: bedrockModelId,
        embeddingModelId: embeddingModelId,
        embeddingModelDimensions: embeddingModelDimensions,
    });

    appStack.addDependency(cfWafStack);

    // Add Aws Solutions Checks and suppress rules
    cdk.Aspects.of(app).add(new AwsSolutionsChecks({ logIgnores: true }));
    suppressCdkNagRules(cfWafStack);
    suppressCdkNagRules(appStack);

    app.synth();
})()
