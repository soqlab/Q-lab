"use client";

import { useEffect, useState } from "react";
import { listPlugins, getPlugin, Plugin } from "../../../lib/api";
import { Download, Star, ExternalLink, Package, Search, BadgeCheck } from "lucide-react";

const CATEGORIES = ["All", "Analysis", "Visualization", "Hardware", "Export", "AI", "Integration"] as const;
type Category = (typeof CATEGORIES)[number];

const SORT_OPTIONS = [
  { value: "downloads", label: "Most Downloaded" },
  { value: "rating", label: "Top Rated" },
  { value: "newest", label: "Newest" },
] as const;

function StarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--muted)" }}>
      <Star size={13} style={{ color: "#f59e0b", fill: "#f59e0b" }} />
      <span style={{ color: "var(--text)", fontWeight: 600 }}>{rating.toFixed(1)}</span>
      <span>({count})</span>
    </span>
  );
}

function InstallButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(command).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={handleCopy}
      style={{
        padding: "6px 14px",
        background: "var(--strong)",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        cursor: "pointer",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {copied ? "Copied!" : "Install"}
    </button>
  );
}

function PluginCard({ plugin }: { plugin: Plugin }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        position: "relative",
      }}
    >
      {plugin.is_official && (
        <span
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "#eef7fb",
            color: "var(--strong)",
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 20,
            border: "1px solid #b8ddef",
          }}
        >
          <BadgeCheck size={11} />
          Official
        </span>
      )}

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 32, lineHeight: 1 }}>{plugin.icon_emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{plugin.name}</span>
            <span
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                fontSize: 11,
                padding: "1px 7px",
                color: "var(--muted)",
                fontFamily: "monospace",
              }}
            >
              v{plugin.version}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>by {plugin.author}</div>
        </div>
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: 13,
          color: "var(--text)",
          lineHeight: 1.55,
          margin: 0,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {plugin.description}
      </p>

      {/* Tags */}
      {plugin.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {plugin.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                fontSize: 11,
                padding: "1px 7px",
                color: "var(--muted)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontSize: 13,
          color: "var(--muted)",
          marginTop: 2,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Download size={13} />
          {plugin.downloads.toLocaleString()}
        </span>
        <StarRating rating={plugin.rating} count={plugin.rating_count} />
      </div>

      {/* Install row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <code
          style={{
            flex: 1,
            background: "var(--code-bg)",
            color: "var(--code-text)",
            fontSize: 11,
            padding: "5px 10px",
            borderRadius: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {plugin.install_command}
        </code>
        <InstallButton command={plugin.install_command} />
        {plugin.homepage_url && (
          <a
            href={plugin.homepage_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--strong)", display: "flex" }}
            title="Details"
          >
            <ExternalLink size={16} />
          </a>
        )}
      </div>
    </div>
  );
}

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<"downloads" | "rating" | "newest">("downloads");
  const [showPublish, setShowPublish] = useState(false);

  useEffect(() => {
    setLoading(true);
    listPlugins({ sort })
      .then((data) => {
        setPlugins(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [sort]);

  const filtered = plugins.filter((p) => {
    const matchCat =
      activeCategory === "All" || p.category.toLowerCase() === activeCategory.toLowerCase();
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.includes(q)) ||
      p.author.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  return (
    <div className="page">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
            <Package size={22} style={{ marginRight: 8, verticalAlign: "middle" }} />
            Q-Lab Plugin Marketplace
          </h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 14 }}>
            Extend Q-Lab with community-built integrations, analysis tools, and exporters
          </p>
        </div>
        <button
          onClick={() => setShowPublish(true)}
          style={{
            padding: "8px 18px",
            background: "var(--strong)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Publish Plugin
        </button>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180, maxWidth: 340 }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            placeholder="Search plugins…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              paddingLeft: 32,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              border: "1px solid var(--input-border)",
              borderRadius: 7,
              fontSize: 13,
              background: "var(--input-bg)",
              color: "var(--text)",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          style={{
            padding: "8px 12px",
            border: "1px solid var(--input-border)",
            borderRadius: 7,
            fontSize: 13,
            background: "var(--input-bg)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Category tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: "1px solid",
              borderColor: activeCategory === cat ? "var(--strong)" : "var(--line)",
              background: activeCategory === cat ? "var(--strong)" : "var(--panel)",
              color: activeCategory === cat ? "#fff" : "var(--muted)",
              fontSize: 13,
              fontWeight: activeCategory === cat ? 600 : 400,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 14 }}>Loading plugins…</div>
      ) : error ? (
        <div style={{ color: "var(--danger-text)", fontSize: 14 }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 14 }}>No plugins match your filters.</div>
      ) : (
        <>
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
            {filtered.length} plugin{filtered.length !== 1 ? "s" : ""}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {filtered.map((plugin) => (
              <PluginCard key={plugin.plugin_id} plugin={plugin} />
            ))}
          </div>
        </>
      )}

      {/* Publish modal placeholder */}
      {showPublish && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setShowPublish(false)}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: 32,
              maxWidth: 480,
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              Publish a Plugin
            </h2>
            <p style={{ margin: "0 0 20px", color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
              Use the Q-Lab Plugin API to submit your extension. Plugins are published via{" "}
              <code style={{ fontSize: 12 }}>POST /api/v1/plugins</code> with a JSON payload matching
              the Plugin schema.
            </p>
            <code
              style={{
                display: "block",
                background: "var(--code-bg)",
                color: "var(--code-text)",
                fontSize: 12,
                padding: 14,
                borderRadius: 8,
                whiteSpace: "pre",
                overflowX: "auto",
                marginBottom: 20,
              }}
            >{`pip install "git+https://github.com/yasseennandally/Q-lab.git#subdirectory=sdk"
qlab plugins publish \\
  --name "My Plugin" \\
  --slug "my-plugin" \\
  --category analysis \\
  --version "0.1.0"`}</code>
            <button
              onClick={() => setShowPublish(false)}
              style={{
                padding: "8px 20px",
                background: "var(--strong)",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                fontSize: 14,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
