const log = require("../../util/logging/util-logging");
const {
    PersonalizeEventsClient,
    PutEventsCommand,
} = require("@aws-sdk/client-personalize-events");

const personalizeEvents = new PersonalizeEventsClient({
    region: process.env.AWS_REGION || "us-east-1",
});

const TRACKING_ID = process.env.PERSONALIZE_TRACKING_ID;

/**
 * POST /api/events
 * Body: { userId, itemId, eventType, sessionId }
 *
 * Records a user interaction event to Personalize for real-time
 * recommendation updates.
 */
exports.handler = async (event) => {
    log.info("Handling event recording request");

    try {
        const body = JSON.parse(event.body || "{}");
        const { userId, itemId, eventType, sessionId } = body;

        if (!userId || !itemId || !eventType) {
            return response(400, { error: "Missing required fields: userId, itemId, eventType" });
        }

        if (!TRACKING_ID) {
            log.warn("Personalize tracking ID not configured, skipping event");
            return response(200, { status: "skipped", reason: "tracking not configured" });
        }

        // Map Cognito username to Personalize user ID (same logic as recommendations)
        let personalizeUserId = userId;
        if (!userId.startsWith("USER-")) {
            let hash = 0;
            for (let i = 0; i < userId.length; i++) {
                hash = ((hash << 5) - hash) + userId.charCodeAt(i);
                hash = hash & hash;
            }
            const userNum = (Math.abs(hash) % 75) + 1;
            personalizeUserId = `USER-${String(userNum).padStart(3, "0")}`;
        }

        await personalizeEvents.send(
            new PutEventsCommand({
                trackingId: TRACKING_ID,
                userId: personalizeUserId,
                sessionId: sessionId || `session-${Date.now()}`,
                eventList: [
                    {
                        eventType: eventType,
                        sentAt: new Date(),
                        itemId: itemId,
                    },
                ],
            }),
        );

        log.info(`Recorded event: ${eventType} for ${personalizeUserId} on ${itemId}`);
        return response(200, { status: "recorded", userId: personalizeUserId, itemId, eventType });
    } catch (error) {
        log.error("Event recording error:", error);
        return response(500, { error: "Failed to record event" });
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
