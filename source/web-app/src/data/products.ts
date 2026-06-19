export interface Product {
    ITEM_ID: string;
    name: string;
    category: string;
    subcategory: string;
    style: string;
    material: string;
    color: string;
    price: number;
    description: string;
    dimensions: { width: number; depth: number; height: number; unit: string };
    room_type: string[];
    rating: number;
    review_count: number;
    in_stock: boolean;
    tags: string[];
    images?: { lifestyle?: string; studio?: string };
}

export interface Category {
    name: string;
    slug: string;
    count: number;
}

let cachedProducts: Product[] | null = null;

/**
 * Load products from the static JSON file.
 * In production, this would be an API call to AppSync/DynamoDB.
 */
export async function loadProducts(): Promise<Product[]> {
    if (cachedProducts) return cachedProducts;

    const response = await fetch("/data/products.json");
    const products: Product[] = await response.json();

    // Map image paths to the S3 bucket served via CloudFront
    cachedProducts = products.map((p) => ({
        ...p,
        images: {
            lifestyle: `/products/${p.ITEM_ID.toLowerCase()}-lifestyle.png`,
            studio: `/products/${p.ITEM_ID.toLowerCase()}-studio.png`,
        },
    }));

    return cachedProducts;
}

export function getCategories(products: Product[]): Category[] {
    const categoryMap = new Map<string, number>();

    for (const p of products) {
        categoryMap.set(p.category, (categoryMap.get(p.category) || 0) + 1);
    }

    return Array.from(categoryMap.entries()).map(([name, count]) => ({
        name,
        slug: name.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-"),
        count,
    }));
}

export function getProductsByCategory(products: Product[], slug: string): Product[] {
    if (slug === "all") return products;
    return products.filter(
        (p) => p.category.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-") === slug
    );
}

export function getProductById(products: Product[], id: string): Product | undefined {
    return products.find((p) => p.ITEM_ID === id);
}

export function getRelatedProducts(products: Product[], product: Product, limit = 4): Product[] {
    return products
        .filter((p) => p.category === product.category && p.ITEM_ID !== product.ITEM_ID)
        .slice(0, limit);
}

export function getRecommendedProducts(products: Product[], limit = 8): Product[] {
    // In production, this calls the /api/recommendations endpoint.
    // Fallback: return a mix of bestsellers and high-rated items.
    return [...products]
        .filter((p) => p.tags.includes("bestseller") || p.rating >= 4.6)
        .sort(() => Math.random() - 0.5)
        .slice(0, limit);
}

/**
 * Fetch personalized recommendations from the API (backed by Amazon Personalize).
 * Falls back to local filtering if the API is unavailable.
 */
export async function fetchRecommendations(userId: string, numResults = 8): Promise<Product[] | null> {
    try {
        const { fetchAuthSession } = await import("aws-amplify/auth");
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();

        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = token;

        const response = await fetch(
            `/api/recommendations?userId=${encodeURIComponent(userId)}&numResults=${numResults}`,
            { headers },
        );
        if (!response.ok) return null;

        const data = await response.json();
        if (data.recommendations && data.recommendations.length > 0) {
            return data.recommendations;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Fetch similar products for a given item (backed by Personalize).
 * Used for "You May Also Like" on product detail pages.
 */
export async function fetchSimilarProducts(itemId: string, userId: string, numResults = 4): Promise<Product[] | null> {
    try {
        const { fetchAuthSession } = await import("aws-amplify/auth");
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();

        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = token;

        const response = await fetch(
            `/api/recommendations?itemId=${encodeURIComponent(itemId)}&userId=${encodeURIComponent(userId)}&numResults=${numResults}`,
            { headers },
        );
        if (!response.ok) return null;

        const data = await response.json();
        if (data.recommendations && data.recommendations.length > 0) {
            return data.recommendations;
        }
        return null;
    } catch {
        return null;
    }
}

export function getNewArrivals(products: Product[], limit = 4): Product[] {
    return products.filter((p) => p.tags.includes("new-arrival")).slice(0, limit);
}
