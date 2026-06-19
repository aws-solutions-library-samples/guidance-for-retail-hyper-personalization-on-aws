import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";
import ProductCard from "@/components/ui/ProductCard";
import { useProducts } from "@/hooks/useProducts";
import {
    getCategories,
    getRecommendedProducts,
    getNewArrivals,
    fetchRecommendations,
    type Product,
} from "@/data/products";

export default function HomePage({ userId }: { userId?: string }) {
    const { products, loading } = useProducts();
    const [recommended, setRecommended] = useState<Product[]>([]);

    useEffect(() => {
        if (products.length === 0) return;
        fetchRecommendations(userId || "guest", 4).then((apiResults) => {
            if (apiResults && apiResults.length > 0) {
                setRecommended(apiResults);
            } else {
                setRecommended(getRecommendedProducts(products, 4));
            }
        });
    }, [products, userId]);

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center text-brand-muted">Loading...</div>;
    }

    const categories = getCategories(products);
    const newArrivals = getNewArrivals(products, 4);

    return (
        <div>
            {/* Hero */}
            <section className="relative h-[70vh] bg-brand-light flex items-center">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
                    <div className="max-w-xl">
                        <p className="text-sm uppercase tracking-widest text-brand-muted mb-4">
                            New Collection
                        </p>
                        <h1 className="font-serif text-5xl md:text-6xl leading-tight mb-6">
                            Designed for
                            <br />
                            how you live
                        </h1>
                        <p className="text-brand-muted text-lg mb-8 leading-relaxed">
                            Timeless furniture crafted from natural materials.
                            Built to last, designed to inspire.
                        </p>
                        <Link
                            to="/collections/all"
                            className="inline-flex items-center gap-2 bg-brand text-white px-8 py-3 text-sm tracking-wide hover:bg-gray-800 transition-colors"
                        >
                            Shop Collection
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>
            </section>

            {/* Categories Grid */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
                <h2 className="font-serif text-3xl mb-10">Browse by Category</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {categories.slice(0, 4).map((cat) => {
                        // Use a representative product image as the category thumbnail
                        const categoryProducts = products.filter(
                            (p) => p.category.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-") === cat.slug
                        );
                        // Pick a visually interesting product (skip first for variety)
                        const categoryProduct = categoryProducts[Math.min(3, categoryProducts.length - 1)];
                        const imageUrl = categoryProduct?.images?.lifestyle;

                        return (
                            <Link
                                key={cat.slug}
                                to={`/collections/${cat.slug}`}
                                className="group relative aspect-[3/4] bg-brand-light rounded-sm overflow-hidden"
                            >
                                {imageUrl && (
                                    <img
                                        src={imageUrl}
                                        alt={cat.name}
                                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                                <div className="absolute bottom-0 left-0 right-0 p-5">
                                    <h3 className="text-sm font-medium text-white">{cat.name}</h3>
                                    <p className="text-xs text-white/70 mt-1">{cat.count} pieces</p>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </section>

            {/* Recommended for You */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="flex items-center justify-between mb-10">
                    <h2 className="font-serif text-3xl">Recommended for You</h2>
                    <Link
                        to="/collections/all"
                        className="text-sm text-brand-muted hover:text-brand flex items-center gap-1 transition-colors"
                    >
                        View all <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {recommended.map((product) => (
                        <ProductCard key={product.ITEM_ID} product={product} />
                    ))}
                </div>
            </section>

            {/* Editorial Banner */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="bg-brand-light rounded-sm p-12 md:p-20 flex flex-col md:flex-row items-center gap-10">
                    <div className="flex-1">
                        <p className="text-xs uppercase tracking-widest text-brand-muted mb-3">
                            AI Shopping Assistant
                        </p>
                        <h2 className="font-serif text-3xl md:text-4xl mb-4">
                            Need help finding the perfect piece?
                        </h2>
                        <p className="text-brand-muted leading-relaxed mb-6">
                            Our AI assistant understands your style, space, and budget.
                            Ask it anything — from "cozy reading chair under $500" to
                            "complete my mid-century living room."
                        </p>
                        <button className="bg-brand text-white px-8 py-3 text-sm tracking-wide hover:bg-gray-800 transition-colors">
                            Start a Conversation
                        </button>
                    </div>
                    <div className="w-full md:w-80 h-64 bg-white rounded-lg shadow-sm overflow-hidden">
                        <img
                            src={products[10]?.images?.lifestyle}
                            alt="AI Shopping Assistant"
                            className="w-full h-full object-cover"
                        />
                    </div>
                </div>
            </section>

            {/* New Arrivals */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-20">
                <h2 className="font-serif text-3xl mb-10">New Arrivals</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {newArrivals.map((product) => (
                        <ProductCard key={product.ITEM_ID} product={product} />
                    ))}
                </div>
            </section>
        </div>
    );
}
