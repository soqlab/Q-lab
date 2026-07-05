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
    <span style={{ color: "#f59e0b", fontSize: 13 }}>
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
    listMarketplaceCategories().then((data) => setCategories((data.categories ?? []).map((c) => c.name))).catch(() => {});
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
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text)" }}>Circuit Marketplace</h1>
          <p style={{ color: "var(--muted)", marginTop: 4 }}>Buy and sell optimized quantum circuits</p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="button"
        >
          {showCreate ? "Cancel" : "+ List Circuit"}
        </button>
      </div>

      {/* Create Listing Panel */}
      {showCreate && (
        <div className="panel" style={{ border: "1px solid var(--strong)", marginTop: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--strong)", marginBottom: 16 }}>New Listing</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Title</label>
              <input type="text" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)}
                className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Author</label>
              <input type="text" value={createAuthor} onChange={(e) => setCreateAuthor(e.target.value)}
                className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Category</label>
              <input type="text" value={createCategory} onChange={(e) => setCreateCategory(e.target.value)}
                placeholder="e.g. optimization"
                className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Tags (comma-separated)</label>
              <input type="text" value={createTags} onChange={(e) => setCreateTags(e.target.value)}
                placeholder="vqe, ansatz, chemistry"
                className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Price (USD)</label>
              <input type="number" min={0} step={0.01} value={createPrice}
                onChange={(e) => setCreatePrice(Number(e.target.value))}
                className="input" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>License</label>
              <select value={createLicense} onChange={(e) => setCreateLicense(e.target.value)}
                className="input" style={{ width: "100%" }}>
                {LICENSE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Description</label>
            <textarea value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} rows={2}
              className="input" style={{ width: "100%", resize: "vertical" }} />
          </div>
          <div style={{ marginTop: 16 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Circuit QASM</label>
            <textarea value={createQasm} onChange={(e) => setCreateQasm(e.target.value)} rows={5}
              className="input" style={{ width: "100%", resize: "vertical", color: "var(--ok)", fontFamily: "ui-monospace,monospace", fontSize: 12 }} />
          </div>
          {createError && (
            <p style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 16 }}>{createError}</p>
          )}
          <button onClick={handleCreate} disabled={creating || !createTitle.trim()}
            className="button"
            style={{ opacity: (creating || !createTitle.trim()) ? 0.5 : 1, marginTop: 16 }}>
            {creating ? "Submitting..." : "Submit Listing"}
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", marginTop: 24 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="input">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 192 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Max Price: ${maxPrice}</label>
          <input type="range" min={0} max={100} value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            style={{ width: "100%" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Sort</label>
          <select value={sort} onChange={(e) => setSort(e.target.value)}
            className="input">
            {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Listings Grid */}
      {loading && <p style={{ color: "var(--muted)", marginTop: 24 }}>Loading listings...</p>}
      {error && (
        <p style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 16px", marginTop: 24 }}>{error}</p>
      )}

      {!loading && !error && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 24 }}>
          {(listings ?? []).map((listing) => (
            <div key={listing.listing_id} className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13, lineHeight: 1.3 }}>{listing.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>by {listing.author}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, background: "rgba(99,102,241,0.15)", color: "var(--strong)", padding: "2px 8px", borderRadius: 6 }}>
                    {listing.category}
                  </span>
                  {listing.price_usd === 0 ? (
                    <span style={{ fontSize: 12, background: "rgba(16,185,129,0.1)", color: "var(--ok)", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>FREE</span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>${listing.price_usd.toFixed(2)}</span>
                  )}
                </div>
              </div>

              <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, WebkitLineClamp: 2, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden" } as React.CSSProperties}>{listing.description}</p>

              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--muted)" }}>
                <StarRating rating={listing.rating} />
                <span>({listing.review_count})</span>
                <span>{listing.downloads} downloads</span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(listing.tags ?? []).slice(0, 3).map((tag) => (
                  <span key={tag} style={{ background: "var(--surface)", color: "var(--muted)", fontSize: 12, padding: "2px 6px", borderRadius: 6 }}>{tag}</span>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 4 }}>
                <span style={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--muted)", padding: "2px 8px", borderRadius: 6 }}>
                  {listing.license}
                </span>
                <button
                  onClick={() => handlePurchase(listing.listing_id)}
                  disabled={purchasingId === listing.listing_id}
                  className="button"
                  style={{ fontSize: 12, padding: "6px 12px", opacity: purchasingId === listing.listing_id ? 0.5 : 1 }}
                >
                  {purchasingId === listing.listing_id ? "..." : "Purchase"}
                </button>
              </div>

              {purchasedQasm[listing.listing_id] && expandedPurchase === listing.listing_id && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>Circuit QASM</span>
                    <button onClick={() => setExpandedPurchase(null)}
                      className="button secondary"
                      style={{ fontSize: 12, padding: "2px 8px" }}>Close</button>
                  </div>
                  <pre style={{ fontFamily: "ui-monospace,monospace", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", overflowX: "auto", whiteSpace: "pre-wrap", color: "var(--ok)", fontSize: 12, maxHeight: 192 }}>
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
