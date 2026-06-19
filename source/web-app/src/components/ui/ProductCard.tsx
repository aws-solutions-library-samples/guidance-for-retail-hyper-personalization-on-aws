import { Link } from "react-router-dom";
import { formatPrice } from "@/lib/utils";
import type { Product } from "@/data/products";

interface ProductCardProps {
    product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
    return (
        <Link to={`/products/${product.ITEM_ID}`} className="group block">
            <div className="aspect-[4/3] overflow-hidden rounded-sm bg-brand-light mb-3">
                <img
                    src={product.images?.lifestyle || product.images?.studio}
                    alt={product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
            </div>
            <div className="space-y-1">
                <p className="text-xs text-brand-muted uppercase tracking-wide">
                    {product.subcategory}
                </p>
                <h3 className="text-sm font-medium group-hover:text-brand-accent transition-colors">
                    {product.name}
                </h3>
                <p className="text-sm text-brand-muted">
                    {formatPrice(product.price)}
                </p>
            </div>
        </Link>
    );
}
