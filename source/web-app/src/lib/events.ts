import { fetchAuthSession } from "aws-amplify/auth";

type EventType = "view" | "add_to_cart" | "purchase";

/**
 * Record a user interaction event to Personalize via the events API.
 * Fire-and-forget — doesn't block the UI.
 */
export function recordEvent(userId: string, itemId: string, eventType: EventType) {
    // Fire and forget — don't await
    sendEvent(userId, itemId, eventType).catch((e) => {
        console.warn("Failed to record event:", e);
    });
}

async function sendEvent(userId: string, itemId: string, eventType: EventType) {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = token;

    await fetch("/api/events", {
        method: "POST",
        headers,
        body: JSON.stringify({
            userId,
            itemId,
            eventType,
            sessionId: `session-${Date.now()}`,
        }),
    });
}
