import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, type Cart } from "@acme/client";
import { api } from "./api";
import { useSession } from "./session";

const pageStyle = { maxWidth: 900, margin: "0 auto", padding: "1rem", fontFamily: "system-ui, sans-serif" };

function formatPrice(cents: number, currency: string | null): string {
  return new Intl.NumberFormat("en", { style: "currency", currency: currency ?? "USD" }).format(cents / 100);
}

export default function CartPage() {
  const { token, email, signOut } = useSession();
  const navigate = useNavigate();
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Signed-out visitors go to the sign-in page rather than seeing an error
  useEffect(() => {
    if (!token) navigate("/sign-in");
  }, [token, navigate]);

  useEffect(() => {
    if (!token) return;
    api.cart.get(token).then(setCart).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        signOut();
        navigate("/sign-in");
      } else {
        setError(err instanceof Error ? err.message : "Could not load your cart");
      }
    });
  }, [token, signOut, navigate]);

  // Each change returns the whole cart, so the page redraws from that response
  async function run(action: () => Promise<Cart>) {
    setError(null);
    try {
      setCart(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (!token) return null;
  if (cart === null && error === null) return <main style={pageStyle}><p>Loading your cart�</p></main>;

  return (
    <main style={pageStyle}>
      <p style={{ margin: 0, color: "#555" }}>Signed in as {email}</p>
      <h1>Your cart</h1>
      {error && <p role="alert" style={{ color: "#a00" }}>{error}</p>}

      {cart && cart.items.length === 0 && (
        <p>Your cart is empty. <Link to="/">Browse the marketplace</Link></p>
      )}

      {cart && cart.items.length > 0 && (
        <>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "1rem" }}>
            {cart.items.map((line) => (
              <li key={line.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem" }}>
                <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.1rem" }}>
                  <Link to={`/products/${line.product.id}`} style={{ color: "inherit" }}>{line.product.title}</Link>
                </h2>
                <p style={{ margin: 0, color: "#555" }}>
                  {line.product.vendor.name} � {formatPrice(line.product.priceCents, line.product.currency)} each
                </p>
                {!line.available && (
                  <p role="status" style={{ color: "#a00", margin: "0.25rem 0" }}>
                    No longer available in this quantity. Change the quantity or remove this item.
                  </p>
                )}
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.5rem" }}>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={line.quantity}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (Number.isInteger(next) && next >= 1 && next <= 99 && token) {
                          run(() => api.cart.setQuantity(token, line.id, next));
                        }
                      }}
                      style={{ width: "4.5rem", marginLeft: "0.4rem" }}
                    />
                  </label>
                  <span>= {formatPrice(line.lineTotalCents, cart.currency)}</span>
                  <button type="button" onClick={() => token && run(() => api.cart.remove(token, line.id))}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: "1.2rem" }}>Total: {formatPrice(cart.totalCents, cart.currency)}</strong>
            <button type="button" disabled={!cart.allAvailable} title={cart.allAvailable ? "" : "Fix the unavailable items first"}>
              Checkout (coming next)
            </button>
          </div>
        </>
      )}

      <p style={{ marginTop: "2rem" }}>
        <Link to="/">Back to the marketplace</Link>
        {" � "}
        <button type="button" onClick={() => { signOut(); navigate("/"); }} style={{ background: "none", border: "none", color: "#06c", cursor: "pointer", padding: 0 }}>
          Sign out
        </button>
      </p>
    </main>
  );
}
