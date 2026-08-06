const log = require("../../util/logging/util-logging");
const {
    ApiGatewayManagementApiClient,
    PostToConnectionCommand,
} = require("@aws-sdk/client-apigatewaymanagementapi");
const {
    BedrockAgentCoreClient,
    InvokeAgentRuntimeCommand,
} = require("@aws-sdk/client-bedrock-agentcore");
const { KMSClient, EncryptCommand, DecryptCommand } = require("@aws-sdk/client-kms");
const { randomUUID } = require("crypto");

/**
 * Reads a required environment variable, throwing at module load if it is unset.
 *
 * All of the values below are injected by CDK (see deploy/src/app-stack.ts).
 * We deliberately do not fall back to hardcoded defaults: a wrong-but-plausible
 * default would silently send traffic to the wrong region or KMS key instead of
 * surfacing the misconfiguration.
 */
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `Missing required environment variable: ${name}. ` +
            "This is set by the CDK stack; check the Lambda configuration.",
        );
    }
    return value;
}

const AWS_REGION = requireEnv("AWS_REGION");
const AGENTCORE_REGION = requireEnv("AGENTCORE_REGION");
const KMS_KEY_ID = requireEnv("SESSION_KMS_KEY_ID");

const agentCoreClient = new BedrockAgentCoreClient({ region: AGENTCORE_REGION });

const kmsClient = new KMSClient({ region: AWS_REGION });

const encryptSessionId = async (sessionId) => {
    const command = new EncryptCommand({
        KeyId: KMS_KEY_ID,
        Plaintext: Buffer.from(sessionId, "utf-8"),
    });
    const response = await kmsClient.send(command);
    return Buffer.from(response.CiphertextBlob).toString("base64");
};

const decryptSessionId = async (encryptedSessionId) => {
    const ciphertextBlob = Buffer.from(encryptedSessionId, "base64");
    const command = new DecryptCommand({ CiphertextBlob: ciphertextBlob });
    const response = await kmsClient.send(command);
    return Buffer.from(response.Plaintext).toString("utf-8");
};

const generateSessionId = () => `session-${randomUUID()}`;

const sendWsResponse = async (apigw, connId, action, data) => {
    try {
        await apigw.send(
            new PostToConnectionCommand({
                Data: JSON.stringify({ action, data }),
                ConnectionId: connId,
            }),
        );
        return { success: true };
    } catch (error) {
        if (error.name === "GoneException") {
            log.warn("Connection is stale, removing...");
            return { success: false, statusCode: 410 };
        }
        throw error;
    }
};

const startHeartbeat = (apigw, connId, messageId) => {
    return setInterval(async () => {
        try {
            await sendWsResponse(apigw, connId, "heartbeat", {
                operation: "heartbeat",
                messageId,
                timestamp: Date.now(),
            });
        } catch (error) {
            log.warn("Heartbeat failed:", error);
        }
    }, 10000);
};

exports.handler = async (event, context) => {
    log.info("Handling chat request.");

    try {
        const domain = event.requestContext.domainName;
        const stage = event.requestContext.stage;
        const endpointUrl = `https://${domain}/${stage}`;
        const connId = event.requestContext.connectionId;

        const apigw = new ApiGatewayManagementApiClient({
            endpoint: endpointUrl,
            region: AWS_REGION,
        });

        const parsedBody = JSON.parse(event.body);
        const body = parsedBody.data || parsedBody;

        // Skip no-op messages entirely — no need to invoke the agent
        if (body.noop === true || body.prompt === "__NOOP__") {
            log.info("No-op message, skipping agent invocation.");
            return { statusCode: 204 };
        }

        const uuid = context.awsRequestId;
        let response = await sendWsResponse(apigw, connId, "chat-update", {
            operation: "start-response",
            messageId: uuid,
        });
        if (!response.success) return { statusCode: response.statusCode };

        const userPrompt = body.prompt || "Hello";

        // Get user identity from WebSocket authorizer context
        const authorizer = event.requestContext.authorizer || {};
        const username = authorizer.username || "guest";

        // Handle session ID — decrypt if provided, generate if not
        let sessionId = null;
        const encryptedSessionId = body.sessionId || body.session_id;

        if (encryptedSessionId) {
            try {
                sessionId = await decryptSessionId(encryptedSessionId);
            } catch (error) {
                log.error("Failed to decrypt session ID, generating new one:", error);
                sessionId = generateSessionId();
            }
        } else {
            sessionId = generateSessionId();
        }

        const agentPayload = { prompt: userPrompt, userId: username };

        const runtimeCommand = new InvokeAgentRuntimeCommand({
            agentRuntimeArn: process.env.AGENTCORE_RUNTIME_ARN,
            runtimeSessionId: sessionId,
            payload: new TextEncoder().encode(JSON.stringify(agentPayload)),
        });

        const heartbeatInterval = startHeartbeat(apigw, connId, uuid);

        try {
            const runtimeResponse = await agentCoreClient.send(runtimeCommand);
            let allChunks = "";
            let parsedResponse = null;
            let fullResponse = "";

            if (runtimeResponse.response) {
                for await (const chunk of runtimeResponse.response) {
                    allChunks += new TextDecoder().decode(chunk);
                }

                try {
                    parsedResponse = JSON.parse(allChunks);
                    log.info("Parsed AgentCore response:", JSON.stringify(parsedResponse).substring(0, 500));

                    if (parsedResponse.status === "error") {
                        response = await sendWsResponse(apigw, connId, "chat-error", {
                            operation: "error",
                            message: parsedResponse.error || "Unknown error",
                            messageId: uuid,
                        });
                        return { statusCode: response.success ? 200 : response.statusCode };
                    }

                    fullResponse = parsedResponse.response ?? parsedResponse.text ?? "No response";

                    // Skip empty responses (e.g. from no-op messages)
                    if (!fullResponse || fullResponse.trim() === "") {
                        clearInterval(heartbeatInterval);
                        return { statusCode: 204 };
                    }
                } catch (parseError) {
                    log.error("Failed to parse JSON:", parseError);
                    fullResponse = allChunks;
                }

                // Simulate streaming by sending words
                if (fullResponse) {
                    const words = fullResponse.split(" ");
                    for (let i = 0; i < words.length; i++) {
                        const word = words[i] + (i < words.length - 1 ? " " : "");
                        response = await sendWsResponse(apigw, connId, "chat-chunk", {
                            operation: "chunk",
                            messageId: uuid,
                            text: word,
                        });
                        if (!response.success) return { statusCode: response.statusCode };
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                }
            } else {
                fullResponse = "No response from agent";
            }

            // Send completion with encrypted session ID
            const completionData = {
                operation: "complete",
                messageId: uuid,
                fullResponse,
            };

            if (sessionId) {
                try {
                    completionData.sessionId = await encryptSessionId(sessionId);
                } catch (error) {
                    log.error("Failed to encrypt session ID:", error);
                }
            }

            response = await sendWsResponse(apigw, connId, "chat-complete", completionData);
            if (!response.success) return { statusCode: response.statusCode };
        } catch (bedrockError) {
            clearInterval(heartbeatInterval);
            log.error("Agent error:", bedrockError);

            const errorMessage =
                bedrockError.name === "ThrottlingException"
                    ? "Too many requests, please try again."
                    : "Failed to process request";

            response = await sendWsResponse(apigw, connId, "chat-error", {
                operation: "error",
                message: errorMessage,
                messageId: uuid,
            });
            return { statusCode: response.success ? 200 : response.statusCode };
        } finally {
            clearInterval(heartbeatInterval);
        }

        return { statusCode: 204 };
    } catch (error) {
        log.error("ERROR sending message", error);
        return { statusCode: 500 };
    }
};
