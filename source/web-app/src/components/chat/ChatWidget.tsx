import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, X, Send } from "lucide-react";
import { connectWebSocket, sendChatMessage, disconnectWebSocket } from "@/lib/websocket";

interface Message {
    id: string;
    text: string;
    sender: "user" | "assistant";
    streaming?: boolean;
}

/**
 * Renders a product card when a product link is detected.
 */
function ProductCard({ name, path, onNavigate }: { name: string; path: string; onNavigate: (p: string) => void }) {
    const itemId = path.split("/").pop() || "";
    const imageUrl = `/products/${itemId.toLowerCase()}-lifestyle.png`;

    return (
        <button
            onClick={() => onNavigate(path)}
            className="flex flex-col w-full my-2 rounded-md bg-white border border-gray-200 hover:border-brand-accent hover:shadow-sm transition-all text-left cursor-pointer overflow-hidden"
        >
            <img
                src={imageUrl}
                alt={name}
                className="w-full h-32 object-cover bg-brand-light"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="text-sm font-medium text-brand px-3 py-2">
                {name} →
            </span>
        </button>
    );
}

/**
 * Renders inline markdown: bold, links (as product cards if internal), plain text.
 */
function MarkdownLine({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }) {
    const parts: React.ReactNode[] = [];

    // Clean up stray ** around links: **[text](url)** → [text](url)
    let cleaned = text.replace(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g, "[$1]($2)");
    // Remove any remaining standalone ** markers
    cleaned = cleaned.replace(/\*\*/g, "");

    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let match;

    // Check if this line has a product link (/products/PROD-XXX)
    const productLinkRegex = /\[([^\]]+)\]\((\/products\/[^)]+)\)/;
    const productMatch = productLinkRegex.exec(cleaned);

    if (productMatch) {
        const beforeLink = cleaned.slice(0, productMatch.index).trim();
        const afterLink = cleaned.slice(productMatch.index + productMatch[0].length).trim();

        return (
            <div>
                {beforeLink && <p className="text-sm text-brand-muted mb-1">{beforeLink}</p>}
                <ProductCard name={productMatch[1]} path={productMatch[2]} onNavigate={onNavigate} />
                {afterLink && <p className="text-sm text-brand-muted mt-1">{afterLink}</p>}
            </div>
        );
    }

    // No product link — render inline links
    while ((match = regex.exec(cleaned)) !== null) {
        if (match.index > lastIndex) {
            parts.push(cleaned.slice(lastIndex, match.index));
        }

        const linkText = match[1];
        const linkUrl = match[2];
        const isInternal = linkUrl.startsWith("/");
        parts.push(
            <a
                key={match.index}
                href={linkUrl}
                onClick={(e) => {
                    if (isInternal) {
                        e.preventDefault();
                        onNavigate(linkUrl);
                    }
                }}
                className="text-brand-accent underline hover:text-brand font-medium cursor-pointer"
            >
                {linkText}
            </a>
        );

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < cleaned.length) {
        parts.push(cleaned.slice(lastIndex));
    }

    return <>{parts}</>;
}

function AssistantMessage({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }) {
    const lines = text.split("\n");

    return (
        <div className="space-y-1">
            {lines.map((line, i) => {
                const trimmed = line.trim();
                if (!trimmed) return null;

                // Headings — strip the ## and render as slightly bolder text
                if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
                    const headingText = trimmed.replace(/^#+\s*/, "");
                    return (
                        <div key={i} className="mt-2">
                            <MarkdownLine text={headingText} onNavigate={onNavigate} />
                        </div>
                    );
                }

                // Bullet points
                if (trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ")) {
                    return (
                        <div key={i} className="flex gap-2 ml-2">
                            <span className="text-brand-muted mt-0.5">•</span>
                            <span className="flex-1"><MarkdownLine text={trimmed.replace(/^[\s]*[-•*]\s*/, "")} onNavigate={onNavigate} /></span>
                        </div>
                    );
                }

                // Regular paragraph
                return (
                    <p key={i} className="mb-1">
                        <MarkdownLine text={trimmed} onNavigate={onNavigate} />
                    </p>
                );
            })}
        </div>
    );
}

export default function ChatWidget() {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [connected, setConnected] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "1",
            text: "Hi! I'm your personal shopping assistant. I can help you find the perfect furniture for your space. What are you looking for?",
            sender: "assistant",
        },
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | undefined>();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        connectWebSocket({
            onConnected: () => setConnected(true),
            onDisconnected: () => setConnected(false),
            onResponseStart: () => {
                setIsLoading(true);
                setMessages((prev) => [
                    ...prev,
                    { id: `resp-${Date.now()}`, text: "", sender: "assistant", streaming: true },
                ]);
            },
            onResponseChunk: (_messageId, text) => {
                setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.sender === "assistant" && last.streaming) {
                        last.text += text;
                    }
                    return updated;
                });
            },
            onResponseComplete: (_messageId, fullResponse, newSessionId) => {
                setIsLoading(false);
                if (newSessionId) setSessionId(newSessionId);
                setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.sender === "assistant") {
                        last.streaming = false;
                        if (fullResponse) last.text = fullResponse;
                    }
                    return updated;
                });
            },
            onError: (_messageId, errorMessage) => {
                setIsLoading(false);
                setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.sender === "assistant" && last.streaming) {
                        last.text = `Sorry, something went wrong: ${errorMessage}`;
                        last.streaming = false;
                    } else {
                        updated.push({
                            id: `err-${Date.now()}`,
                            text: `Sorry, something went wrong: ${errorMessage}`,
                            sender: "assistant",
                        });
                    }
                    return updated;
                });
            },
        });

        return () => {
            disconnectWebSocket();
        };
    }, [isOpen]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleNavigate = useCallback((path: string) => {
        navigate(path);
        setIsOpen(false);
    }, [navigate]);

    const handleSend = useCallback(() => {
        if (!input.trim() || isLoading || !connected) return;

        setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), text: input, sender: "user" },
        ]);
        sendChatMessage(input, sessionId);
        setInput("");
    }, [input, isLoading, connected, sessionId]);

    const handleClear = () => {
        setMessages([
            { id: "1", text: "Hi! I'm your personal shopping assistant. I can help you find the perfect furniture for your space. What are you looking for?", sender: "assistant" },
        ]);
        setSessionId(undefined);
    };

    return (
        <>
            {isOpen && (
                <div className="fixed bottom-20 right-6 w-[420px] h-[560px] bg-white rounded-lg shadow-2xl border border-gray-100 flex flex-col z-50">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <div>
                            <h3 className="text-sm font-medium">Shopping Assistant</h3>
                            <p className="text-xs text-brand-muted">
                                {connected ? "Powered by AI" : "Connecting..."}
                            </p>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={handleClear}
                                className="px-2 py-1 hover:bg-gray-50 rounded transition-colors text-xs text-brand-muted"
                            >
                                Clear
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1 hover:bg-gray-50 rounded-full transition-colors"
                                aria-label="Close chat"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <div
                                    className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                                        msg.sender === "user"
                                            ? "bg-brand text-white"
                                            : "bg-gray-50 text-brand"
                                    }`}
                                >
                                    {msg.sender === "assistant" ? (
                                        msg.text ? (
                                            <AssistantMessage text={msg.text} onNavigate={handleNavigate} />
                                        ) : (
                                            <span className="text-brand-muted animate-pulse">Thinking...</span>
                                        )
                                    ) : (
                                        msg.text
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-3 border-t border-gray-100">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                                placeholder={connected ? "Ask me anything..." : "Connecting..."}
                                className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:border-brand-accent transition-colors"
                                disabled={!connected || isLoading}
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || isLoading || !connected}
                                className="p-2 bg-brand text-white rounded-md hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                aria-label="Send message"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed bottom-6 right-6 w-14 h-14 bg-brand text-white rounded-full shadow-lg hover:bg-gray-800 transition-colors flex items-center justify-center z-50"
                aria-label={isOpen ? "Close chat" : "Open AI Shopping Assistant"}
            >
                {isOpen ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
            </button>
        </>
    );
}
