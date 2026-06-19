const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const {
    CognitoIdentityProviderClient,
    GetUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const cognitoClient = new CognitoIdentityProviderClient({});
const jwksUrl = `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}/.well-known/jwks.json`;

function generatePolicy(principalId, effect, resource, context = {}) {
    const authResponse = { principalId };
    if (effect && resource) {
        authResponse.policyDocument = {
            Version: "2012-10-17",
            Statement: [
                {
                    Action: "execute-api:Invoke",
                    Effect: effect,
                    Resource: resource,
                },
            ],
        };
    }
    authResponse.context = context;
    return authResponse;
}

async function verifyJwtToken(token, jwksUrl, clientId) {
    const client = jwksClient({ jwksUri: jwksUrl });
    const getKey = (header, callback) => {
        client.getSigningKey(header.kid, (err, key) => {
            const signingKey = key.publicKey || key.rsaPublicKey;
            callback(null, signingKey);
        });
    };

    return new Promise((resolve, reject) => {
        jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, payload) => {
            if (err) reject(err);
            if (payload.client_id !== clientId) {
                reject(new Error("Invalid Token: Wrong Client ID"));
            }
            resolve(payload);
        });
    });
}

exports.handler = async (event, context) => {
    try {
        const token = event.queryStringParameters.token;

        const verifiedClaims = await verifyJwtToken(token, jwksUrl, process.env.CLIENT_ID);
        if (!verifiedClaims) {
            return generatePolicy(context.invokedFunctionArn, "Deny", event.methodArn);
        }

        const user = await cognitoClient.send(new GetUserCommand({ AccessToken: token }));
        if (!user) {
            return generatePolicy(context.invokedFunctionArn, "Deny", event.methodArn);
        }

        const userData = {
            username: user.Username,
            connectionId: event.requestContext.connectionId,
            connectionUrl: `https://${event.requestContext.domainName}/${event.requestContext.stage}`,
        };

        for (const attribute of user.UserAttributes) {
            userData[attribute.Name] = attribute.Value;
        }

        const target = event.methodArn.substring(0, event.methodArn.lastIndexOf("/") + 1) + "*";
        return generatePolicy(context.invokedFunctionArn, "Allow", target, userData);
    } catch (e) {
        console.log("Error trying to authorize", e);
        return generatePolicy(context.invokedFunctionArn, "Deny", event.methodArn);
    }
};
