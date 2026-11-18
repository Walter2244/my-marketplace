import { Link } from "react-router-dom";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import type { CategoryNode, ProductSearchParams, ProductSummary } from "@acme/client";

type Sort = NonNullable<ProductSearchParams["sort"]>;
type CategoryOption = { id: number; label: string };

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
}

function unitLabel(unit: ProductSummary["unitOfSale"]): string {
  switch (unit) {
    case "PER_HEAD": return "per head";
    case "PER_KG": return "per kg";
    case "PER_CRATE": return "per crate";
    default: return "each";
  }
}

// Products sit only in the lowest-level categories, so only those can be chosen as a filter.
// Each option shows its full path, such as "Agriculture � Livestock � Goats".
function leafCategories(nodes: CategoryNode[], prefix = ""): CategoryOption[] {
  const options: CategoryOption[] = [];
  for (const node of nodes) {
    const label = prefix ? `${prefix} � ${node.name}` : node.name;
    if (node.children.length === 0) {
      options.push({ id: node.id, label });
    } else {
      options.push(...leafCategories(node.children, label));
    }
  }
  return options;
}

// Turns a dollar amount typed by the buyer into whole cents. Empty means "no limit".
function toCents(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars < 0) return undefined;
  return Math.round(dollars * 100);
}

export default function App() {
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [minDollars, setMinDollars] = useState("");
  const [maxDollars, setMaxDollars] = useState("");
  const [inStock, setInStock] = useState(false);
  const [sort, setSort] = useState<Sort>("relevance");

  // Each search gets a number. Only the newest search may update the page.
  const latestSearch = useRef(0);

  async function runSearch(params: ProductSearchParams) {
    const searchId = ++latestSearch.current;
    setError(null);
    try {
      const results = await api.catalogue.search.products({ limit: 20, ...params });
      if (searchId === latestSearch.current) setProducts(results);
    } catch (err) {
      if (searchId === latestSearch.current) {
        setProducts([]);
        setError(err instanceof Error ? err.message : "Could not search products");
      }
    }
  }

  useEffect(() => {
    api.catalogue.categories
      .tree()
      .then((tree) => setCategories(leafCategories(tree)))
      .catch(() => setCategories([]));
    runSearch({ sort: "relevance" });
    // The first load runs once, when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runSearch({
      sort,
      q: q.trim() || undefined,
      categoryId: categoryId ? Number(categoryId) : undefined,
      minPriceCents: toCents(minDollars),
      maxPriceCents: toCents(maxDollars),
      inStock: inStock || undefined,
    });
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Marketplace</h1>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <label>
          Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="goat, mango, tractor�" style={{ width: "100%" }} />
        </label>

        <label>
          Category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ width: "100%" }}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <label>
            Min price ($)
            <input type="number" min="0" step="0.01" value={minDollars} onChange={(e) => setMinDollars(e.target.value)} />
          </label>
          <label>
            Max price ($)
            <input type="number" min="0" step="0.01" value={maxDollars} onChange={(e) => setMaxDollars(e.target.value)} />
          </label>
          <label>
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>
          <label style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock only
          </label>
        </div>

        <button type="submit" style={{ justifySelf: "start", padding: "0.5rem 1.25rem" }}>Search</button>
      </form>

      {error && <p role="alert" style={{ color: "#a00" }}>{error}</p>}

      {products === null && <p>Loading products�</p>}
      {products !== null && products.length === 0 && !error && <p>No products match these filters.</p>}

      {products !== null && products.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "1rem" }}>
          {products.map((p) => (
            <li key={p.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem" }}>
              <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.1rem" }}><Link to={`/products/${p.id}`} style={{ color: "inherit" }}>{p.title}</Link></h2>
              <p style={{ margin: 0 }}>
                {formatPrice(p.priceCents, p.currency)} {unitLabel(p.unitOfSale)}
              </p>
              <p style={{ margin: "0.25rem 0 0", color: "#555" }}>
                {p.vendor.name}
                {p.category ? ` � ${p.category.name}` : ""}
                {p.inStock ? "" : " � out of stock"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}



