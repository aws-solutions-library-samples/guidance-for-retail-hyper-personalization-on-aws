import { Link } from "react-router-dom";
import { Search, ShoppingBag, LogOut } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { getCategories } from "@/data/products";
import type { AuthUser } from "aws-amplify/auth";

interface HeaderProps {
    user: AuthUser | null;
    onSignOut: () => void;
}

export default function Header({ user, onSignOut }: HeaderProps) {
    const { products } = useProducts();
    const categories = getCategories(products);

    return (
        <header className="sticky top-0 z-50 bg-white border-b border-gray-100">
            {/* Announcement bar */}
            <div className="bg-brand text-white text-center text-xs py-2 tracking-wide">
                Free shipping on orders over $150 — Handcrafted with care
            </div>

            {/* Main nav */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo */}
                    <Link to="/" className="font-serif text-2xl tracking-tight">
                        Nordheim
                    </Link>

                    {/* Navigation */}
                    <nav className="hidden md:flex items-center gap-8">
                        {categories.slice(0, 5).map((cat) => (
                            <Link
                                key={cat.slug}
                                to={`/collections/${cat.slug}`}
                                className="text-sm text-gray-600 hover:text-brand transition-colors"
                            >
                                {cat.name}
                            </Link>
                        ))}
                        <Link
                            to="/collections/all"
                            className="text-sm text-gray-600 hover:text-brand transition-colors"
                        >
                            All
                        </Link>
                    </nav>

                    {/* Actions */}
                    <div className="flex items-center gap-4">
                        <button className="p-2 hover:bg-gray-50 rounded-full transition-colors" aria-label="Search">
                            <Search className="w-5 h-5" />
                        </button>
                        <span className="text-xs text-brand-muted hidden sm:inline">
                            {user?.username || "Guest"}
                        </span>
                        <button className="p-2 hover:bg-gray-50 rounded-full transition-colors relative" aria-label="Cart">
                            <ShoppingBag className="w-5 h-5" />
                            <span className="absolute -top-0.5 -right-0.5 bg-brand-accent text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                                0
                            </span>
                        </button>
                        <button
                            onClick={onSignOut}
                            className="p-2 hover:bg-gray-50 rounded-full transition-colors"
                            aria-label="Sign out"
                        >
                            <LogOut className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}
