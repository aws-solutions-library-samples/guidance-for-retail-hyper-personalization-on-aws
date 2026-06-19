import { useParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { ArrowLeft, Star, Truck, Shield, RotateCcw } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { recordEvent } from "@/lib/events";
import ProductCard from "@/components/ui/ProductCard";
import { useProducts } from "@/hooks/useProducts";
import { getProductById, getRelatedProducts, fetchSimilarProducts, type Product } from "@/data/products";

export default function ProductPage() {
    const { id } = useParams<{ id: string }>();
    const { products, loading } = useProducts();
    const [related, setRelated] = useState<Product[]>([]);

    const product = getProductById(products, id || "");

    useEffect(() => {
        if (!product || products.length === 0) return;
        fetchSimilarProducts(product.ITEM_ID, "guest", 4).then((apiResults) => {
            if (apiResults && apiResults.length > 0) {
                setRelated(apiResults);
            } else {
                setRelated(getRelatedProducts(products, product));
            }
        });
    }, [product, products]);

    // Record product view event for Personalize
    useEffect(() => {
        if (!product) return;
        recordEvent("guest", product.ITEM_ID, "view");
    }, [product]);

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center text-brand-muted">Loading...</div>;
    }

    if (!product) {
        return (
            <div className="max-w-7xl mx-auto px-4 py-20 text-center">
                <p className="text-brand-muted text-lg">Product not found.</p>
                <Link to="/" className="text-sm text-brand-accent hover:underline mt-4 inline-block">
                    Back to home
                </Link>
            </div>
        );
    }

    const categorySlug = product.category.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-");

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Breadcrumb */}
            <Link
                to={`/collections/${categorySlug}`}
                className="inline-flex items-center gap-2 text-sm text-brand-muted hover:text-brand mb-8 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" />
                {product.category}
            </Link>

            {/* Product Detail */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Images */}
                <div className="space-y-4">
                    <div className="aspect-square bg-brand-light rounded-sm overflow-hidden">
                        <img
                            src={product.images?.lifestyle}
                            alt={product.name}
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <div className="aspect-square bg-brand-light rounded-sm overflow-hidden">
                        <img
                            src={product.images?.studio}
                            alt={`${product.name} — studio view`}
                            className="w-full h-full object-cover"
                        />
                    </div>
                </div>

                {/* Info */}
                <div className="lg:sticky lg:top-28 lg:self-start">
                    <p className="text-xs uppercase tracking-widest text-brand-muted mb-2">
                        {product.subcategory} · {product.style}
                    </p>
                    <h1 className="font-serif text-3xl md:text-4xl mb-4">{product.name}</h1>

                    {/* Rating */}
                    <div className="flex items-center gap-2 mb-4">
                        <div className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                    key={i}
                                    className={`w-4 h-4 ${
                                        i < Math.floor(product.rating)
                                            ? "fill-brand-accent text-brand-accent"
                                            : "text-gray-200"
                                    }`}
                                />
                            ))}
                        </div>
                        <span className="text-sm text-brand-muted">
                            {product.rating} ({product.review_count} reviews)
                        </span>
                    </div>

                    <p className="text-2xl font-medium mb-6">{formatPrice(product.price)}</p>

                    <p className="text-brand-muted leading-relaxed mb-8">
                        {product.description}
                    </p>

                    {/* Specs */}
                    <div className="grid grid-cols-2 gap-4 mb-8 text-sm">
                        <div>
                            <span className="text-brand-muted">Material</span>
                            <p className="font-medium capitalize">{product.material}</p>
                        </div>
                        <div>
                            <span className="text-brand-muted">Color</span>
                            <p className="font-medium">{product.color}</p>
                        </div>
                        <div>
                            <span className="text-brand-muted">Dimensions</span>
                            <p className="font-medium">
                                {product.dimensions.width} × {product.dimensions.depth} × {product.dimensions.height} {product.dimensions.unit}
                            </p>
                        </div>
                        <div>
                            <span className="text-brand-muted">Room</span>
                            <p className="font-medium">{product.room_type.join(", ")}</p>
                        </div>
                    </div>

                    {/* Tags */}
                    {product.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-8">
                            {product.tags.map((tag) => (
                                <span
                                    key={tag}
                                    className="text-xs px-2 py-1 bg-brand-light rounded-sm capitalize"
                                >
                                    {tag.replace("-", " ")}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Add to cart */}
                    <button className="w-full bg-brand text-white py-4 text-sm tracking-wide hover:bg-gray-800 transition-colors mb-4">
                        Add to Basket
                    </button>

                    {/* Trust signals */}
                    <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-100">
                        <div className="flex flex-col items-center text-center gap-1">
                            <Truck className="w-5 h-5 text-brand-muted" />
                            <span className="text-xs text-brand-muted">Free Delivery</span>
                        </div>
                        <div className="flex flex-col items-center text-center gap-1">
                            <RotateCcw className="w-5 h-5 text-brand-muted" />
                            <span className="text-xs text-brand-muted">30-Day Returns</span>
                        </div>
                        <div className="flex flex-col items-center text-center gap-1">
                            <Shield className="w-5 h-5 text-brand-muted" />
                            <span className="text-xs text-brand-muted">5-Year Warranty</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* You May Also Like */}
            {related.length > 0 && (
                <section className="mt-20">
                    <h2 className="font-serif text-2xl mb-8">You May Also Like</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {related.map((p) => (
                            <ProductCard key={p.ITEM_ID} product={p} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
