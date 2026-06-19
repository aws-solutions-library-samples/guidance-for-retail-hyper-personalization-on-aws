import { fetchAuthSession } from "aws-amplify/auth";

export interface ChatCallbacks {
    onConnected: () => void;
    onDisconnected: () => void;
    onResponseStart: (messageId: string) => void;
    onResponseChunk: (messageId: string, text: string) => void;
    onResponseComplete: (messageId: string, fullResponse: string, sessionId?: string) => void;
    onError: (messageId: string, message: string) => void;
}

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

export function connectWebSocket(callbacks: ChatCallbacks) {
    if (socket?.readyState === WebSocket.OPEN) return;

    const connect = async () => {
        try {
            const session = await fetchAuthSession();
            const token = session.tokens?.accessToken?.toString();
            if (!token) {
                console.error("No auth token available");
                return;
            }

            // Get WebSocket URL from config
            const configRes = await fetch("/config.json");
            const config = await configRes.json();
            const wsUrl = config?.WebSocket?.url;

            if (!wsUrl) {
                console.error("No WebSocket URL in config");
                return;
            }

            socket = new WebSocket(`${wsUrl}?token=${token}`);

            socket.addEventListener("open", () => {
                reconnectAttempts = 0;
                callbacks.onConnected();
                // Send no-op to initialize session
                if (socket?.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ action: "chat", noop: true, prompt: "__NOOP__" }));
                }
            });

            socket.addEventListener("close", () => {
                callbacks.onDisconnected();
                // Auto-reconnect with backoff
                reconnectAttempts++;
                if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                    setTimeout(() => connect(), delay);
                }
            });

            socket.addEventListener("error", (e) => {
                console.error("WebSocket error:", e);
            });

            socket.addEventListener("message", (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data, callbacks);
                } catch (e) {
                    console.error("Failed to parse WebSocket message:", e);
                }
            });
        } catch (e) {
            console.error("Failed to connect WebSocket:", e);
        }
    };

    connect();
}

function handleMessage(message: { action: string; data: any }, callbacks: ChatCallbacks) {
    const { action, data } = message;

    switch (action) {
        case "chat-update":
            callbacks.onResponseStart(data.messageId);
            break;
        case "chat-chunk":
            callbacks.onResponseChunk(data.messageId, data.text);
            break;
        case "chat-complete":
            callbacks.onResponseComplete(data.messageId, data.fullResponse, data.sessionId);
            break;
        case "chat-error":
            callbacks.onError(data.messageId, data.message);
            break;
        case "heartbeat":
            // Ignore heartbeats
            break;
        default:
            console.log("Unknown WebSocket action:", action);
    }
}

export function sendChatMessage(prompt: string, sessionId?: string) {
    if (socket?.readyState !== WebSocket.OPEN) {
        console.error("WebSocket not connected");
        return false;
    }

    socket.send(JSON.stringify({
        action: "chat",
        data: { prompt, sessionId },
    }));

    return true;
}

export function disconnectWebSocket() {
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
    socket?.close();
    socket = null;
}
