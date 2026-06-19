import { useState, useEffect } from "react";
import { loadProducts, type Product } from "@/data/products";

export function useProducts() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadProducts()
            .then(setProducts)
            .finally(() => setLoading(false));
    }, []);

    return { products, loading };
}
