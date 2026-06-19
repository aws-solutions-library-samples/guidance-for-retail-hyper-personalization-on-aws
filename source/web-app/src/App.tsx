import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { getCurrentUser, signOut, type AuthUser } from "aws-amplify/auth";
import Header from "./components/layout/Header";
import Footer from "./components/layout/Footer";
import HomePage from "./pages/HomePage";
import CollectionPage from "./pages/CollectionPage";
import ProductPage from "./pages/ProductPage";
import ChatWidget from "./components/chat/ChatWidget";
import LoginPage from "./pages/LoginPage";

export default function App() {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [authEnabled, setAuthEnabled] = useState(true);

    useEffect(() => {
        getCurrentUser()
            .then((u) => {
                setUser(u);
                setAuthEnabled(true);
            })
            .catch((err) => {
                // If the error is about Amplify not being configured, skip auth
                if (err?.name === "AuthUserPoolException" || err?.message?.includes("Auth")) {
                    setAuthEnabled(false);
                    setUser(null);
                } else {
                    setAuthEnabled(true);
                    setUser(null);
                }
            })
            .finally(() => setAuthChecked(true));
    }, []);

    if (!authChecked) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-brand-muted">Loading...</p>
            </div>
        );
    }

    // If auth is enabled and user isn't signed in, show login
    if (authEnabled && !user) {
        return <LoginPage onSignIn={setUser} />;
    }

    return (
        <div className="min-h-screen flex flex-col">
            <Header user={user} onSignOut={() => { signOut(); setUser(null); }} />
            <main className="flex-1">
                <Routes>
                    <Route path="/" element={<HomePage userId={user?.username} />} />
                    <Route path="/collections/:slug" element={<CollectionPage />} />
                    <Route path="/products/:id" element={<ProductPage />} />
                </Routes>
            </main>
            <Footer />
            <ChatWidget />
        </div>
    );
}
