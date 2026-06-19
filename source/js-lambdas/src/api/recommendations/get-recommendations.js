const log = require("../../util/logging/util-logging");
const {
    PersonalizeRuntimeClient,
    GetRecommendationsCommand,
} = require("@aws-sdk/client-personalize-runtime");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, BatchGetCommand } = require("@aws-sdk/lib-dynamodb");

const personalizeClient = new PersonalizeRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
});

const dbClient = new DynamoDBClient({});
const dynamoClient = DynamoDBDocumentClient.from(dbClient);

const CAMPAIGN_ARN = process.env.PERSONALIZE_CAMPAIGN_ARN;
const PRODUCT_TABLE = process.env.PRODUCT_TABLE_NAME;

/**
 * GET /api/recommendations?userId=USER-001&numResults=8
 *
 * Returns personalized product recommendations for a given user.
 * Enriches Personalize results with full product metadata from DynamoDB.
 *
 * The userId can be a Cognito username — it will be mapped to a synthetic
 * Personalize user ID for the demo.
 */
exports.handler = async (event) => {
    log.info("Handling recommendations request");

    try {
        const params = event.queryStringParameters || {};
        const numResults = parseInt(params.numResults || "8", 10);

        // Map the provided userId to a Personalize user ID
        // In production, this would be a proper user mapping table.
        // For the demo, we hash the username to one of our 75 synthetic users.
        let userId = params.userId || "USER-001";
        if (!userId.startsWith("USER-")) {
            // Hash the username to a consistent user ID (1-75)
            let hash = 0;
            for (let i = 0; i < userId.length; i++) {
                hash = ((hash << 5) - hash) + userId.charCodeAt(i);
                hash = hash & hash; // Convert to 32-bit integer
            }
            const userNum = (Math.abs(hash) % 75) + 1;
            userId = `USER-${String(userNum).padStart(3, "0")}`;
        }

        log.info(`Mapped user to Personalize ID: ${userId}`);

        // If itemId is provided, get similar items (for "You May Also Like")
        const itemId = params.itemId;

        if (!CAMPAIGN_ARN) {
            return response(503, {
                error: "Personalize campaign not configured",
                message: "Recommendations are not available yet.",
            });
        }

        let recResponse;
        if (itemId) {
            // Similar items: pass both userId and itemId for personalized similar items
            recResponse = await personalizeClient.send(
                new GetRecommendationsCommand({
                    campaignArn: CAMPAIGN_ARN,
                    userId: userId,
                    itemId: itemId,
                    numResults: numResults,
                }),
            );
        } else {
            // User recommendations: just userId
            recResponse = await personalizeClient.send(
                new GetRecommendationsCommand({
                    campaignArn: CAMPAIGN_ARN,
                    userId: userId,
                    numResults: numResults,
                }),
            );
        }

        const itemIds = (recResponse.itemList || []).map((item) => item.itemId)
            .filter((id) => id !== itemId); // Exclude the current item from "similar" results

        if (itemIds.length === 0) {
            return response(200, { recommendations: [], userId });
        }

        // Enrich with product metadata from DynamoDB
        const batchResponse = await dynamoClient.send(
            new BatchGetCommand({
                RequestItems: {
                    [PRODUCT_TABLE]: {
                        Keys: itemIds.map((id) => ({ ITEM_ID: id })),
                    },
                },
            }),
        );

        const products = (batchResponse.Responses?.[PRODUCT_TABLE] || []).map((item) => ({
            ...item,
            // Convert Decimal strings back to numbers for the frontend
            price: Number(item.price),
            rating: Number(item.rating),
            // Add image URLs
            images: {
                lifestyle: `/products/${item.ITEM_ID.toLowerCase()}-lifestyle.png`,
                studio: `/products/${item.ITEM_ID.toLowerCase()}-studio.png`,
            },
        }));

        // Maintain Personalize ranking order
        const productMap = new Map(products.map((p) => [p.ITEM_ID, p]));
        const ranked = itemIds
            .map((id) => productMap.get(id))
            .filter(Boolean);

        return response(200, {
            recommendations: ranked,
            userId,
            source: "personalize",
        });
    } catch (error) {
        log.error("Recommendations error:", error);

        // If Personalize isn't ready, return a graceful fallback
        if (error.name === "ResourceNotFoundException" || error.name === "InvalidInputException") {
            return response(503, {
                error: "Personalize not ready",
                message: "The recommendation model is still training. Please try again later.",
            });
        }

        return response(500, { error: "Internal server error" });
    }
};

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store",
        },
        body: JSON.stringify(body),
    };
}
