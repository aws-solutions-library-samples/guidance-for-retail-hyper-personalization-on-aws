import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Amplify } from "aws-amplify";
import App from "./App";
import "./index.css";

async function bootstrap() {
    // Load runtime config (deployed by CDK as config.json)
    try {
        const res = await fetch("/config.json");
        if (res.ok) {
            const config = await res.json();
            if (config?.Auth?.Cognito) {
                Amplify.configure({
                    Auth: {
                        Cognito: {
                            userPoolId: config.Auth.Cognito.userPoolId,
                            userPoolClientId: config.Auth.Cognito.userPoolClientId,
                            identityPoolId: config.Auth.Cognito.identityPoolId,
                        },
                    },
                });
            }
        }
    } catch {
        // No config.json available (local dev) — auth will be skipped
        console.warn("No config.json found — running without auth");
    }

    ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </React.StrictMode>,
    );
}

bootstrap();
