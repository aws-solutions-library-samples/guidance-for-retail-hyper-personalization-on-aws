import { Link } from "react-router-dom";

export default function Footer() {
    return (
        <footer className="bg-brand text-white mt-20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
                    {/* Brand */}
                    <div className="md:col-span-1">
                        <h3 className="font-serif text-xl mb-4">Nordheim</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Timeless Scandinavian living. Furniture and homeware designed
                            to bring warmth, function, and quiet elegance to modern homes.
                        </p>
                    </div>

                    {/* Shop */}
                    <div>
                        <h4 className="text-sm font-medium mb-4 uppercase tracking-wider">Shop</h4>
                        <ul className="space-y-2 text-sm text-gray-400">
                            <li><Link to="/collections/sofas-seating" className="hover:text-white transition-colors">Sofas & Seating</Link></li>
                            <li><Link to="/collections/tables" className="hover:text-white transition-colors">Tables</Link></li>
                            <li><Link to="/collections/lighting" className="hover:text-white transition-colors">Lighting</Link></li>
                            <li><Link to="/collections/storage" className="hover:text-white transition-colors">Storage</Link></li>
                            <li><Link to="/collections/beds-bedroom" className="hover:text-white transition-colors">Beds & Bedroom</Link></li>
                        </ul>
                    </div>

                    {/* About */}
                    <div>
                        <h4 className="text-sm font-medium mb-4 uppercase tracking-wider">About</h4>
                        <ul className="space-y-2 text-sm text-gray-400">
                            <li><a href="#" className="hover:text-white transition-colors">Our Story</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">Sustainability</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">Craftsmanship</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
                        </ul>
                    </div>

                    {/* Help */}
                    <div>
                        <h4 className="text-sm font-medium mb-4 uppercase tracking-wider">Help</h4>
                        <ul className="space-y-2 text-sm text-gray-400">
                            <li><a href="#" className="hover:text-white transition-colors">Delivery & Returns</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">Care Guide</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">FAQ</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">Contact Us</a></li>
                        </ul>
                    </div>
                </div>

                <div className="border-t border-gray-800 mt-12 pt-8 text-xs text-gray-500 flex justify-between items-center">
                    <p>© 2026 Nordheim. All rights reserved.</p>
                    <p className="text-gray-600">
                        Powered by{" "}
                        <a href="https://aws.amazon.com" className="text-gray-400 hover:text-white transition-colors">
                            AWS
                        </a>
                    </p>
                </div>
            </div>
        </footer>
    );
}
