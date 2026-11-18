import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, type ProductSummary, type PublicLivestockRecords, type VendorRating } from "@acme/client";
import { api } from "./api";

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

const pageStyle = { maxWidth: 900, margin: "0 auto", padding: "1rem", fontFamily: "system-ui, sans-serif" };

export default function ProductPage() {
  const { id } = useParams();
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [records, setRecords] = useState<PublicLivestockRecords | null>(null);
  const [rating, setRating] = useState<VendorRating | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const productId = Number(id);
    setProduct(null);
    setRecords(null);
    setRating(null);
    setNotFound(false);
    setError(null);

    if (!Number.isInteger(productId) || productId < 1) {
      setNotFound(true);
      return;
    }

    api.catalogue.products
      .get(productId)
      .then(async (p) => {
        if (cancelled) return;
        setProduct(p);
        const [livestock, vendorRating] = await Promise.all([
          api.livestock.records(productId),
          api.reviews.reviews.vendorRating(p.vendor.id),
        ]);
        if (cancelled) return;
        setRecords(livestock);
        setRating(vendorRating);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof Error ? err.message : "Could not load this product");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) {
    return (
      <main style={pageStyle}>
        <p>This product could not be found.</p>
        <Link to="/">Back to the marketplace</Link>
      </main>
    );
  }

  if (error && product === null) {
    return (
      <main style={pageStyle}>
        <p role="alert" style={{ color: "#a00" }}>{error}</p>
        <Link to="/">Back to the marketplace</Link>
      </main>
    );
  }

  if (product === null) {
    return <main style={pageStyle}><p>Loading product�</p></main>;
  }

  const hasLivestockRecords =
    records !== null &&
    (records.identification !== null || records.healthRecords.length > 0 || records.declaration !== null);

  return (
    <main style={pageStyle}>
      <Link to="/">Back to the marketplace</Link>

      <h1 style={{ marginBottom: "0.25rem" }}>{product.title}</h1>
      <p style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
        {formatPrice(product.priceCents, product.currency)} {unitLabel(product.unitOfSale)}
      </p>
      <p style={{ margin: "0 0 1rem", color: "#555" }}>
        Sold by {product.vendor.name}
        {product.category ? ` � ${product.category.name}` : ""}
        {" � "}
        {product.inStock ? "In stock" : "Out of stock"}
      </p>

      <p>{product.description ?? "No description provided."}</p>

      {product.attributes.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1.1rem" }}>Details</h2>
          <ul>
            {product.attributes.map((a) => (
              <li key={a.name}>{a.name}: {a.value}</li>
            ))}
          </ul>
        </section>
      )}

      {hasLivestockRecords && records && (
        <section>
          <h2 style={{ fontSize: "1.1rem" }}>Livestock records</h2>
          {records.identification && <p>Tag number: {records.identification.tagNumber}</p>}
          {records.healthRecords.length > 0 && (
            <ul>
              {records.healthRecords.map((r, i) => (
                <li key={i}>
                  {r.kind.toLowerCase()} on {formatDate(r.recordedOn)}: {r.description}
                </li>
              ))}
            </ul>
          )}
          {records.declaration && (
            <p style={{ color: "#555" }}>
              Health declaration made {formatDate(records.declaration.declaredAt)}.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 style={{ fontSize: "1.1rem" }}>Vendor rating</h2>
        {rating === null ? (
          <p>Loading rating�</p>
        ) : rating.reviewCount === 0 ? (
          <p>No reviews yet.</p>
        ) : (
          <p>
            {rating.averageRating?.toFixed(1)} out of 5, from {rating.reviewCount}{" "}
            {rating.reviewCount === 1 ? "review" : "reviews"}.
          </p>
        )}
      </section>

      <p style={{ marginTop: "2rem", color: "#777" }}>Buying from this page is not available yet.</p>
    </main>
  );
}

