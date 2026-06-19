import { useState } from "react";
import { signIn, confirmSignIn, getCurrentUser, type AuthUser } from "aws-amplify/auth";

interface LoginPageProps {
    onSignIn: (user: AuthUser) => void;
}

export default function LoginPage({ onSignIn }: LoginPageProps) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [needsNewPassword, setNeedsNewPassword] = useState(false);

    const handleSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const result = await signIn({ username, password });

            if (result.isSignedIn) {
                const user = await getCurrentUser();
                onSignIn(user);
            } else if (result.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
                setNeedsNewPassword(true);
            } else {
                setError(`Additional step required: ${result.nextStep?.signInStep}`);
            }
        } catch (err: any) {
            setError(err.message || "Sign in failed");
        } finally {
            setLoading(false);
        }
    };

    const handleNewPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const result = await confirmSignIn({ challengeResponse: newPassword });

            if (result.isSignedIn) {
                const user = await getCurrentUser();
                onSignIn(user);
            } else {
                setError("Something went wrong. Please try again.");
            }
        } catch (err: any) {
            setError(err.message || "Failed to set new password");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-brand-light flex items-center justify-center px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <h1 className="font-serif text-3xl mb-2">Nordheim</h1>
                    <p className="text-sm text-brand-muted">
                        {needsNewPassword ? "Set a new password" : "Sign in to continue"}
                    </p>
                </div>

                {needsNewPassword ? (
                    <form onSubmit={handleNewPassword} className="bg-white p-8 rounded-sm shadow-sm space-y-4">
                        <p className="text-sm text-brand-muted">
                            You need to set a new password to continue.
                        </p>
                        <div>
                            <label htmlFor="newPassword" className="block text-sm text-brand-muted mb-1">
                                New Password
                            </label>
                            <input
                                id="newPassword"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-sm text-sm focus:outline-none focus:border-brand-accent"
                                required
                                minLength={8}
                            />
                            <p className="text-xs text-brand-muted mt-1">
                                Min 8 characters, uppercase, lowercase, number, and symbol
                            </p>
                        </div>

                        {error && <p className="text-sm text-red-600">{error}</p>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-brand text-white py-3 text-sm tracking-wide hover:bg-gray-800 transition-colors disabled:opacity-50"
                        >
                            {loading ? "Setting password..." : "Set Password & Sign In"}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleSignIn} className="bg-white p-8 rounded-sm shadow-sm space-y-4">
                        <div>
                            <label htmlFor="username" className="block text-sm text-brand-muted mb-1">
                                Username
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-sm text-sm focus:outline-none focus:border-brand-accent"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm text-brand-muted mb-1">
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-sm text-sm focus:outline-none focus:border-brand-accent"
                                required
                            />
                        </div>

                        {error && <p className="text-sm text-red-600">{error}</p>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-brand text-white py-3 text-sm tracking-wide hover:bg-gray-800 transition-colors disabled:opacity-50"
                        >
                            {loading ? "Signing in..." : "Sign In"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
