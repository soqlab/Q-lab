"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createMarketplaceListing,
  listMarketplace,
  listMarketplaceCategories,
  purchaseMarketplaceListing,
  MarketplaceListing,
} from "@/lib/api";

const LICENSE_OPTIONS = ["MIT", "Apache-2.0", "CC-BY-4.0", "proprietary"];
const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "rating", label: "Top Rated" },
  { value: "downloads", label: "Most Downloads" },
  { value: "price_asc", label: "Price: Low to High" },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="text-yellow-400 text-sm">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i}>{i < Math.round(rating) ? "★" : "☆"}</span>
      ))}
    </span>
  );
}

export default function CircuitMarketplacePage() {
  const [categories, setCategories] = useState<string[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [category, setCategory] = useState("");
  const [maxPrice, setMaxPrice] = useState(100);
  const [sort, setSort] = useState("newest");

  // Purchase
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [purchasedQasm, setPurchasedQasm] = useState<Record<string, string>>({});
  const [expandedPurchase, setExpandedPurchase] = useState<string | null>(null);

  // Create listing panel
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [createTags, setCreateTags] = useState("");
  const [createPrice, setCreatePrice] = useState(0);
  const [createAuthor, setCreateAuthor] = useState("");
  const [createLicense, setCreateLicense] = useState("MIT");
  const [createQasm, setCreateQasm] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listMarketplace({ category: category || undefined, max_price: maxPrice, sort });
      setListings(data.listings);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load listings");
    } finally {
      setLoading(false);
    }
  }, [category, maxPrice, sort]);

  useEffect(() => {
    listMarketplaceCategories().then((data) => setCategories(data.categories.map((c) => c.name))).catch(() => {});
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  async function handlePurchase(listingId: string) {
    setPurchasingId(listingId);
    try {
      const res = await purchaseMarketplaceListing(listingId, "me");
      setPurchasedQasm((prev) => ({ ...prev, [listingId]: res.circuit_qasm }));
      setExpandedPurchase(listingId);
    } catch {
      // silently allow retry
    } finally {
      setPurchasingId(null);
    }
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const listing = await createMarketplaceListing({
        title: createTitle,
        description: createDescription,
        category: createCategory,
        tags: createTags.split(",").map((t) => t.trim()).filter(Boolean),
        price_usd: createPrice,
        author: createAuthor,
        license: createLicense,
        circuit_qasm: createQasm,
      });
      setListings((prev) => [listing, ...prev]);
      setShowCreate(false);
      setCreateTitle("");
      setCreateDescription("");
      setCreateCategory("");
      setCreateTags("");
      setCreatePrice(0);
      setCreateAuthor("");
      setCreateLicense("MIT");
      setCreateQasm("");
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Failed to create listing");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Circuit Marketplace</h1>
          <p className="text-gray-400 mt-1">Buy and sell optimized quantum circuits</p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm"
        >
          {showCreate ? "Cancel" : "+ List Circuit"}
        </button>
      </div>

      {/* Create Listing Panel */}
      {showCreate && (
        <div className="bg-gray-900 border border-indigo-800 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-semibold text-indigo-300">New Listing</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Title</label>
              <input type="text" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Author</label>
              <input type="text" value={createAuthor} onChange={(e) => setCreateAuthor(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Category</label>
              <input type="text" value={createCategory} onChange={(e) => setCreateCategory(e.target.value)}
                placeholder="e.g. optimization"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Tags (comma-separated)</label>
              <input type="text" value={createTags} onChange={(e) => setCreateTags(e.target.value)}
                placeholder="vqe, ansatz, chemistry"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Price (USD)</label>
              <input type="number" min={0} step={0.01} value={createPrice}
                onChange={(e) => setCreatePrice(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">License</label>
              <select value={createLicense} onChange={(e) => setCreateLicense(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {LICENSE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Circuit QASM</label>
            <textarea value={createQasm} onChange={(e) => setCreateQasm(e.target.value)} rows={5}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-green-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
          </div>
          {createError && (
            <p className="text-red-400 bg-red-950 border border-red-800 rounded px-3 py-2 text-sm">{createError}</p>
          )}
          <button onClick={handleCreate} disabled={creating || !createTitle.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors">
            {creating ? "Submitting..." : "Submit Listing"}
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="min-w-48">
          <label className="block text-xs text-gray-500 mb-1">Max Price: ${maxPrice}</label>
          <input type="range" min={0} max={100} value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="w-full accent-indigo-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sort</label>
          <select value={sort} onChange={(e) => setSort(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Listings Grid */}
      {loading && <p className="text-gray-400 animate-pulse">Loading listings...</p>}
      {error && (
        <p className="text-red-400 bg-red-950 border border-red-800 rounded px-4 py-2">{error}</p>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.map((listing) => (
            <div key={listing.listing_id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm leading-snug">{listing.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">by {listing.author}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs bg-indigo-900 text-indigo-300 px-2 py-0.5 rounded">
                    {listing.category}
                  </span>
                  {listing.price_usd === 0 ? (
                    <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded font-semibold">FREE</span>
                  ) : (
                    <span className="text-xs text-gray-200 font-semibold">${listing.price_usd.toFixed(2)}</span>
                  )}
                </div>
              </div>

              <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">{listing.description}</p>

              <div className="flex items-center gap-3 text-xs text-gray-500">
                <StarRating rating={listing.rating} />
                <span>({listing.review_count})</span>
                <span>{listing.downloads} downloads</span>
              </div>

              <div className="flex flex-wrap gap-1">
                {listing.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded">{tag}</span>
                ))}
              </div>

              <div className="flex items-center justify-between mt-auto pt-1">
                <span className="text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded">
                  {listing.license}
                </span>
                <button
                  onClick={() => handlePurchase(listing.listing_id)}
                  disabled={purchasingId === listing.listing_id}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                >
                  {purchasingId === listing.listing_id ? "..." : "Purchase"}
                </button>
              </div>

              {purchasedQasm[listing.listing_id] && expandedPurchase === listing.listing_id && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-green-400 font-semibold">Circuit QASM</span>
                    <button onClick={() => setExpandedPurchase(null)}
                      className="text-xs text-gray-500 hover:text-gray-300">Close</button>
                  </div>
                  <pre className="bg-gray-950 border border-gray-700 rounded p-3 text-green-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-48">
                    {purchasedQasm[listing.listing_id]}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
