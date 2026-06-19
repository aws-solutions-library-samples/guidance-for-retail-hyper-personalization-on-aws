import { useParams } from "react-router-dom";
import ProductCard from "@/components/ui/ProductCard";
import { useProducts } from "@/hooks/useProducts";
import { getCategories, getProductsByCategory } from "@/data/products";

export default function CollectionPage() {
    const { slug } = useParams<{ slug: string }>();
    const { products, loading } = useProducts();

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center text-brand-muted">Loading...</div>;
    }

    const categories = getCategories(products);
    const category = categories.find((c) => c.slug === slug);
    const title = slug === "all" ? "All Products" : category?.name || "Collection";
    const filtered = getProductsByCategory(products, slug || "all");

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            {/* Header */}
            <div className="mb-10">
                <h1 className="font-serif text-4xl mb-3">{title}</h1>
                <p className="text-brand-muted">
                    {filtered.length} {filtered.length === 1 ? "piece" : "pieces"}
                </p>
            </div>

            {/* Filters bar */}
            <div className="flex items-center gap-4 mb-8 pb-4 border-b border-gray-100">
                <span className="text-sm text-brand-muted">Filter by:</span>
                {["Style", "Material", "Price", "Room"].map((filter) => (
                    <button
                        key={filter}
                        className="text-sm px-3 py-1.5 border border-gray-200 rounded-sm hover:border-brand transition-colors"
                    >
                        {filter}
                    </button>
                ))}
            </div>

            {/* Product Grid */}
            {filtered.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {filtered.map((product) => (
                        <ProductCard key={product.ITEM_ID} product={product} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-20">
                    <p className="text-brand-muted text-lg">
                        No products found in this collection.
                    </p>
                </div>
            )}
        </div>
    );
}
