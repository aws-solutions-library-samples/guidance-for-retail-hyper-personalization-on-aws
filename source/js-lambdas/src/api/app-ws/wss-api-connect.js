const log = require("../../util/logging/util-logging");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const dbClient = new DynamoDBClient({ logger: log });
const dynamoClient = DynamoDBDocumentClient.from(dbClient);

exports.handler = async (event) => {
    log.info("Handling WebSocket connect request.");

    const user = event.requestContext.authorizer;
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;
    const connectionId = event.requestContext.connectionId;

    try {
        await dynamoClient.send(
            new PutCommand({
                TableName: process.env.TABLE_NAME,
                Item: {
                    type: "session",
                    id: user.sub,
                    ttl: Math.floor(Date.now() / 1000),
                    domainName: domain,
                    stage: stage,
                    connectionId: connectionId,
                    ...user,
                },
            }),
        );

        return { statusCode: 201 };
    } catch (e) {
        log.error("Request failed.", e);
        throw e;
    }
};
