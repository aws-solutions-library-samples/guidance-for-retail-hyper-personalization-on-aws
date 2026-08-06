import json
import logging
import os
import sys
from datetime import datetime
from decimal import Decimal

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from strands import Agent, tool
from strands.models import BedrockModel

RequestsInstrumentor().instrument()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s - %(message)s"))
logger.addHandler(handler)

logger.info("Starting AgentCore application")

app = BedrockAgentCoreApp()

region = os.environ.get("AWS_REGION", "us-east-1")
session = boto3.Session()

# Service clients
bedrock_agent_runtime = boto3.client("bedrock-agent-runtime", region_name=region)
personalize_runtime = boto3.client("personalize-runtime", region_name=region)
dynamodb = boto3.resource("dynamodb", region_name=region)


def _require_env(name: str) -> str:
    """Read a required environment variable, failing at import time if unset.

    Injected by CDK via the AgentCore Runtime's environment variables (see
    deploy/src/app-stack.ts). Unlike the optional values below — where a missing
    value degrades a single tool — the model ID has no usable fallback, so we
    fail immediately and visibly rather than at first invocation.
    """
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            "This is set by the CDK stack; check the AgentCore Runtime configuration."
        )
    return value


# Configuration from environment
#
# The model ID is configuration, not source code: foundation models are
# deprecated and replaced over time, and customers need to be able to point the
# agent at a different model (or a cross-region inference profile) without
# editing this file. Change it via the `bedrock_model_id` CDK context value in
# source/deploy/cdk.json.
BEDROCK_MODEL_ID = _require_env("BEDROCK_MODEL_ID")

KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
PRODUCT_TABLE_NAME = os.environ.get("PRODUCT_TABLE_NAME", "")
PERSONALIZE_CAMPAIGN_ARN = os.environ.get("PERSONALIZE_CAMPAIGN_ARN", "")

product_table = dynamodb.Table(PRODUCT_TABLE_NAME) if PRODUCT_TABLE_NAME else None


# ─── Helper ───────────────────────────────────────────────────────────────────

def decimal_to_native(obj):
    """Convert DynamoDB Decimal types to Python native types for JSON serialization."""
    if isinstance(obj, Decimal):
        return float(obj) if obj % 1 else int(obj)
    elif isinstance(obj, dict):
        return {k: decimal_to_native(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_native(i) for i in obj]
    return obj


# ─── Tools ────────────────────────────────────────────────────────────────────

@tool
def search_products(query: str, num_results: int = 5) -> str:
    """Search the product catalog using natural language. Use this when a customer
    asks about products by describing what they want (e.g., "comfortable reading chair",
    "modern dining table for small spaces", "warm lighting for bedroom").

    Args:
        query: Natural language description of what the customer is looking for.
        num_results: Number of results to return (default 5, max 10).

    Returns:
        JSON string with matching products including ITEM_ID, name, description, price, and relevance.
    """
    if not KNOWLEDGE_BASE_ID:
        return json.dumps({"error": "Knowledge Base not configured"})

    try:
        num_results = min(num_results, 10)
        response = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": num_results,
                }
            },
        )

        results = []
        for result in response.get("retrievalResults", []):
            content = result.get("content", {}).get("text", "")
            score = result.get("score", 0)

            # Try to extract ITEM_ID from the content (it's in the KB docs as the filename)
            item_id = None
            location = result.get("location", {})
            s3_uri = location.get("s3Location", {}).get("uri", "")
            if s3_uri:
                # Extract from S3 key like: s3://bucket/products/prod-042.md
                filename = s3_uri.split("/")[-1].replace(".md", "")
                item_id = filename.upper()  # prod-042 → PROD-042

            # Also try to find ITEM_ID in the content text
            if not item_id:
                import re
                id_match = re.search(r'PROD-\d{3}', content)
                if id_match:
                    item_id = id_match.group(0)

            results.append({
                "ITEM_ID": item_id,
                "content": content,
                "relevance_score": round(score, 3),
            })

        return json.dumps({"results": results, "query": query, "count": len(results)})

    except Exception as e:
        logger.error("search_products failed: %s", str(e))
        return json.dumps({"error": str(e)})


@tool
def get_recommendations(user_id: str = "USER-001", num_results: int = 5) -> str:
    """Get personalized product recommendations for a specific user based on their
    browsing and purchase history. Use this when a customer asks for suggestions
    without specifying exactly what they want, or to complement search results
    with personalized picks.

    Args:
        user_id: The user ID to get recommendations for (default USER-001).
        num_results: Number of recommendations to return (default 5, max 10).

    Returns:
        JSON string with recommended product IDs and their metadata.
    """
    if not PERSONALIZE_CAMPAIGN_ARN:
        return json.dumps({"error": "Personalize campaign not configured"})

    try:
        num_results = min(num_results, 10)
        response = personalize_runtime.get_recommendations(
            campaignArn=PERSONALIZE_CAMPAIGN_ARN,
            userId=user_id,
            numResults=num_results,
        )

        item_ids = [item["itemId"] for item in response.get("itemList", [])]

        if not item_ids or not product_table:
            return json.dumps({"recommendations": item_ids, "user_id": user_id})

        # Enrich with product metadata
        products = []
        for item_id in item_ids:
            try:
                result = product_table.get_item(Key={"ITEM_ID": item_id})
                if "Item" in result:
                    item = decimal_to_native(result["Item"])
                    products.append({
                        "ITEM_ID": item["ITEM_ID"],
                        "name": item.get("name"),
                        "category": item.get("category"),
                        "subcategory": item.get("subcategory"),
                        "price": item.get("price"),
                        "style": item.get("style"),
                        "material": item.get("material"),
                        "color": item.get("color"),
                        "description": item.get("description"),
                        "rating": item.get("rating"),
                    })
            except Exception as e:
                logger.warning("Failed to fetch product %s: %s", item_id, str(e))
                products.append({"ITEM_ID": item_id})

        return json.dumps({
            "recommendations": products,
            "user_id": user_id,
            "count": len(products),
            "source": "personalize",
        })

    except Exception as e:
        logger.error("get_recommendations failed: %s", str(e))
        return json.dumps({"error": str(e)})


@tool
def get_product_details(item_id: str) -> str:
    """Get full details for a specific product by its ID. Use this when you need
    complete information about a product (dimensions, materials, availability)
    or when a customer asks about a specific item.

    Args:
        item_id: The product ID (e.g., "PROD-001", "PROD-042").

    Returns:
        JSON string with complete product details including dimensions, materials,
        pricing, availability, and image URLs.
    """
    if not product_table:
        return json.dumps({"error": "Product table not configured"})

    try:
        response = product_table.get_item(Key={"ITEM_ID": item_id.upper()})

        if "Item" not in response:
            return json.dumps({"error": f"Product {item_id} not found"})

        item = decimal_to_native(response["Item"])

        # Add image URLs
        item["images"] = {
            "lifestyle": f"/products/{item['ITEM_ID'].lower()}-lifestyle.png",
            "studio": f"/products/{item['ITEM_ID'].lower()}-studio.png",
        }

        return json.dumps(item)

    except Exception as e:
        logger.error("get_product_details failed: %s", str(e))
        return json.dumps({"error": str(e)})


@tool
def get_products_by_category(category: str, limit: int = 10) -> str:
    """Browse products in a specific category. Use this when a customer wants to
    see what's available in a category (e.g., "show me your lighting",
    "what tables do you have?").

    Args:
        category: The category name (e.g., "Sofas & Seating", "Tables", "Lighting",
                  "Storage", "Beds & Bedroom", "Rugs & Textiles", "Decor & Accessories").
        limit: Maximum number of products to return (default 10).

    Returns:
        JSON string with products in the specified category.
    """
    if not product_table:
        return json.dumps({"error": "Product table not configured"})

    try:
        response = product_table.query(
            IndexName="category-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("category").eq(category),
            Limit=min(limit, 20),
        )

        products = []
        for item in response.get("Items", []):
            item = decimal_to_native(item)
            products.append({
                "ITEM_ID": item["ITEM_ID"],
                "name": item.get("name"),
                "subcategory": item.get("subcategory"),
                "price": item.get("price"),
                "style": item.get("style"),
                "material": item.get("material"),
                "color": item.get("color"),
                "rating": item.get("rating"),
            })

        return json.dumps({
            "category": category,
            "products": products,
            "count": len(products),
        })

    except Exception as e:
        logger.error("get_products_by_category failed: %s", str(e))
        return json.dumps({"error": str(e)})


@tool
def get_current_datetime() -> str:
    """Get the current date and time.

    Returns:
        Current datetime in ISO format (YYYY-MM-DDTHH:MM:SS)
    """
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


# ─── Agent Creation ───────────────────────────────────────────────────────────

def create_agent() -> Agent:
    """Create the AI Shopping Assistant agent with retail tools."""

    system_prompt = """You are the AI Shopping Assistant for Nordheim, a premium Scandinavian-inspired furniture store.

Your role is to help customers find the perfect furniture and homeware for their homes. You are knowledgeable, warm, and have excellent taste in interior design.

## How to help customers:

1. **Product Discovery**: When customers describe what they're looking for, use `search_products` to find relevant items by meaning (not just keywords). For example, "something cozy for reading" or "modern desk for a small apartment."

2. **Personalized Recommendations**: When customers want suggestions without specific criteria, use `get_recommendations` to show them items tailored to their preferences and history.

3. **Product Details**: When customers ask about a specific product, use `get_product_details` to provide complete information including dimensions, materials, and pricing.

4. **Category Browsing**: When customers want to explore a category, use `get_products_by_category` to show what's available.

## Response style:

- Be conversational and warm, like a knowledgeable friend who loves interior design
- Keep responses concise — highlight 2-3 key products rather than overwhelming with options
- Mention specific details that matter: materials, dimensions, style compatibility
- Suggest complementary pieces when appropriate ("this pairs beautifully with...")
- Use markdown formatting: **bold** for product names, bullet points for features
- Include prices naturally in your recommendations
- If you're unsure about something, say so honestly
- IMPORTANT: When recommending products, always include a product link in this exact format: [Product Name](/products/PROD-XXX) — this creates a clickable link for the customer. You MUST use the actual ITEM_ID (like PROD-001, PROD-042, PROD-156) from the tool results. The ITEM_ID always starts with "PROD-" followed by a three-digit number. NEVER use product names as IDs. If you cannot find the ITEM_ID in the tool results, do NOT include a link.

## Important:

- Our categories are: Sofas & Seating, Tables, Lighting, Storage, Beds & Bedroom, Rugs & Textiles, Decor & Accessories
- Prices are in USD
- Always recommend products that are in stock
- When showing multiple products, vary the styles and price points unless the customer has specified preferences
- The user's identity is provided at the start of each message as [User ID: xxx]. Use this ID when calling get_recommendations to provide personalized results.
"""

    bedrock_model = BedrockModel(
        model_id=BEDROCK_MODEL_ID,
        region_name=region,
        temperature=0.3,
    )

    return Agent(
        system_prompt=system_prompt,
        name="NordheimAssistant",
        model=bedrock_model,
        tools=[
            search_products,
            get_recommendations,
            get_product_details,
            get_products_by_category,
            get_current_datetime,
        ],
    )


# ─── Entrypoint ──────────────────────────────────────────────────────────────

@app.entrypoint
async def invoke(payload=None, context=None):
    """Main entrypoint for the agent"""
    logger.info("Agent invocation started")

    session_id = context.session_id if context else None
    if not session_id:
        logger.error("No session ID in context")
        return {"status": "error", "error": "No session ID provided"}

    try:
        query = payload.get("prompt", "Hello") if payload else "Hello"
        user_id = payload.get("userId", "guest") if payload else "guest"

        # Handle no-op messages for session initialization
        if query == "__NOOP__" or (payload and payload.get("noop") is True):
            logger.info("No-op message, returning empty response")
            return {"status": "success", "response": ""}

        logger.info("Processing query: %s (user: %s)", query, user_id)

        agent = create_agent()
        # Prepend user context so the agent knows who it's talking to
        contextualized_query = f"[User ID: {user_id}]\n\n{query}"
        result = agent(contextualized_query)

        response_text = str(result)
        logger.info("Agent response generated (length: %s)", len(response_text))

        return {"status": "success", "response": response_text}

    except Exception as e:
        logger.error("Agent invocation failed: %s", str(e), exc_info=True)
        return {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
