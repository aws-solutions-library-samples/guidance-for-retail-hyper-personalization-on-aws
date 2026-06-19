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
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

/**
 * defines the scope for the WebACL
 * Cloudfront - for cloud front for cloud front distributions
 * Regional - for load balancers and api gateway's
 */
export enum WafV2Scope {
    /**
     * for cloudfront distributions
     */
    CLOUDFRONT = "CLOUDFRONT",
    /**
     * for api gateways, loadbalancers and other supported resources
     */
    REGIONAL = "REGIONAL",
}

export interface Wafv2BasicConstructProps extends cdk.StackProps {
    /**
     * The ACL scope.
     */
    readonly wafScope?: WafV2Scope;

    /**
     * Optional rules for the firewall. These will be added after the default rules.
     */
    readonly rules?:
        | Array<cdk.aws_wafv2.CfnWebACL.RuleProperty | cdk.IResolvable>
        | cdk.IResolvable;

    /**
     * The region where the WAF will be deployed
     */
    readonly region?: string;

    /**
     * Enable AWS managed rules (Common Rule Set, SQL injection, Known Bad Inputs)
     * @default true
     */
    readonly enableAWSManagedRules?: boolean;

    /**
     * Enable rate-based rule to limit requests from a single IP
     * @default true
     */
    readonly enableRateLimiting?: boolean;

    /**
     * The maximum number of requests allowed from a single IP in the rate limit time period
     * @default 1000
     */
    readonly rateLimit?: number;

    /**
     * Enable geographic blocking for specified countries
     * @default true
     */
    readonly enableGeoBlocking?: boolean;

    /**
     * Country codes to block (ISO 3166-1 alpha-2 codes)
     * @default ["CN", "RU", "KP"]
     */
    readonly blockedCountries?: string[];
}

/**
 * Default input properties
 */
const defaultProps: Partial<Wafv2BasicConstructProps> = {
    region: "us-east-1",
    enableAWSManagedRules: true,
    enableRateLimiting: true,
    rateLimit: 1000,
    enableGeoBlocking: true,
    blockedCountries: ["CN", "RU", "KP"],
};

/**
 * Deploys a basic WAFv2 ACL that is open by default
 */
export class Wafv2BasicConstruct extends Construct {
    public webacl: cdk.aws_wafv2.CfnWebACL;

    constructor(
        parent: Construct,
        name: string,
        props: Wafv2BasicConstructProps,
    ) {
        super(parent, name);

        props = { ...defaultProps, ...props };

        const wafScopeString = props.wafScope!.toString();

        if (
            props.wafScope === WafV2Scope.CLOUDFRONT &&
            props.region !== "us-east-1"
        ) {
            throw new Error(
                "Only supported region for WAFv2 scope when set to CLOUDFRONT is us-east-1. " +
                    "see - https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-wafv2-webacl.html",
            );
        }

        // Prepare the default rules
        const defaultRules: CfnWebACL.RuleProperty[] = [];

        // Add AWS managed rules if enabled
        if (props.enableAWSManagedRules) {
            defaultRules.push(...this.createAWSManagedRules());
        }

        // Add rate limiting rule if enabled
        if (props.enableRateLimiting) {
            defaultRules.push(this.createRateLimitRule(props.rateLimit!));
        }

        // Add geo blocking rule if enabled
        if (
            props.enableGeoBlocking &&
            props.blockedCountries &&
            props.blockedCountries.length > 0
        ) {
            defaultRules.push(this.createGeoBlockRule(props.blockedCountries));
        }

        // Combine default rules with any custom rules provided
        const allRules = props.rules
            ? [...defaultRules, ...(props.rules as CfnWebACL.RuleProperty[])]
            : defaultRules;

        const webacl = new cdk.aws_wafv2.CfnWebACL(this, "webacl", {
            description:
                "Enhanced WAF with managed rules, rate limiting, and geo blocking",
            defaultAction: {
                allow: {}, // allow everything by default
            },
            rules: allRules,
            scope: wafScopeString,
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: "WAFACLGlobal",
                sampledRequestsEnabled: true,
            },
        });

        this.webacl = webacl;
    }

    /**
     * Creates AWS managed rules for common protections
     * @returns Array of WAF rules using AWS managed rule sets
     */
    private createAWSManagedRules(): CfnWebACL.RuleProperty[] {
        return [
            // AWS Core Rule Set (CRS) - protects against common web exploits
            {
                name: "AWS-AWSManagedRulesCommonRuleSet",
                priority: 10,
                statement: {
                    managedRuleGroupStatement: {
                        name: "AWSManagedRulesCommonRuleSet",
                        vendorName: "AWS",
                    },
                },
                overrideAction: { none: {} },
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    metricName: "AWSManagedRulesCommonRuleSet",
                    sampledRequestsEnabled: true,
                },
            },
            // SQL Injection protection
            {
                name: "AWS-AWSManagedRulesSQLiRuleSet",
                priority: 20,
                statement: {
                    managedRuleGroupStatement: {
                        name: "AWSManagedRulesSQLiRuleSet",
                        vendorName: "AWS",
                    },
                },
                overrideAction: { none: {} },
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    metricName: "AWSManagedRulesSQLiRuleSet",
                    sampledRequestsEnabled: true,
                },
            },
            // Known bad inputs protection
            {
                name: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
                priority: 30,
                statement: {
                    managedRuleGroupStatement: {
                        name: "AWSManagedRulesKnownBadInputsRuleSet",
                        vendorName: "AWS",
                    },
                },
                overrideAction: { none: {} },
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    metricName: "AWSManagedRulesKnownBadInputsRuleSet",
                    sampledRequestsEnabled: true,
                },
            },
            // IP Reputation List - blocks requests from known bad IPs
            {
                name: "AWS-AWSManagedRulesAmazonIpReputationList",
                priority: 40,
                statement: {
                    managedRuleGroupStatement: {
                        name: "AWSManagedRulesAmazonIpReputationList",
                        vendorName: "AWS",
                    },
                },
                overrideAction: { none: {} },
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    metricName: "AWSManagedRulesAmazonIpReputationList",
                    sampledRequestsEnabled: true,
                },
            },
        ];
    }

    /**
     * Creates a rate-based rule to limit requests from a single IP
     * @param limit Maximum number of requests allowed in a 5-minute period
     * @returns WAF rate-based rule
     */
    private createRateLimitRule(limit: number): CfnWebACL.RuleProperty {
        return {
            name: "RateLimitRule",
            priority: 50,
            statement: {
                rateBasedStatement: {
                    limit,
                    aggregateKeyType: "IP",
                },
            },
            action: {
                block: {},
            },
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: "RateLimitRule",
                sampledRequestsEnabled: true,
            },
        };
    }

    /**
     * Creates a geo-blocking rule to block requests from specified countries
     * @param countries Array of country codes to block (ISO 3166-1 alpha-2 codes)
     * @returns WAF geo-matching rule
     */
    private createGeoBlockRule(countries: string[]): CfnWebACL.RuleProperty {
        return {
            name: "GeoBlockRule",
            priority: 60,
            statement: {
                geoMatchStatement: {
                    countryCodes: countries,
                },
            },
            action: {
                block: {},
            },
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: "GeoBlockRule",
                sampledRequestsEnabled: true,
            },
        };
    }
}
