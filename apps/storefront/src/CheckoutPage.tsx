import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, type Cart, type DeliveryChoices, type DeliveryMethod, type Order } from "@acme/client";
import { api } from "./api";
import { useSession } from "./session";
import { checkAddress, emptyAddress, type AddressFields } from "./address";

const pageStyle = { maxWidth: 900, margin: "0 auto", padding: "1rem", fontFamily: "system-ui, sans-serif" };

const METHOD_LABELS: Record<DeliveryMethod, string> = {
  NONE: "No delivery",
  COLLECTION: "Collection",
  FLAT_FEE: "Delivery at a flat fee",
  QUOTE: "Delivery by quote",
};

function formatPrice(cents: number, currency: string | null): string {
  return new Intl.NumberFormat("en", { style: "currency", currency: currency ?? "USD" }).format(cents / 100);
}

// The delivery methods every item from one vendor offers. A method is shown only if all of that vendor's items support it.
function methodsFor(cart: Cart, vendorId: number, offeredByProduct: Map<number, DeliveryMethod[]>): DeliveryMethod[] {
  const items = cart.items.filter((l) => l.product.vendor.id === vendorId);
  if (items.length === 0) return [];
  const lists = items.map((l) => offeredByProduct.get(l.product.id) ?? []);
  return (["COLLECTION", "FLAT_FEE", "QUOTE"] as DeliveryMethod[]).filter((m) => lists.every((list) => list.includes(m)));
}

export default function CheckoutPage() {
  const { token, signOut } = useSession();
  const navigate = useNavigate();
  const [cart, setCart] = useState<Cart | null>(null);
  const [offered, setOffered] = useState<Map<number, DeliveryMethod[]>>(new Map());
  const [address, setAddress] = useState<AddressFields>(emptyAddress);
  const [choices, setChoices] = useState<Record<string, DeliveryMethod>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) navigate("/sign-in", { state: { from: "/checkout" } });
  }, [token, navigate]);

  // Load the cart, then ask each product which delivery options it offers
  useEffect(() => {
    if (!token) return;
    api.cart
      .get(token)
      .then(async (c) => {
        setCart(c);
        const entries = await Promise.all(
          c.items.map(async (l) => {
            const options = await api.catalogue.products.deliveryOptions(l.product.id).catch(() => []);
            const methods = options.map((o) => o.kind as DeliveryMethod);
            return [l.product.id, methods] as const;
          })
        );
        setOffered(new Map(entries));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          signOut();
          navigate("/sign-in");
        } else {
          setError(err instanceof Error ? err.message : "Could not load your cart");
        }
      });
  }, [token, signOut, navigate]);

  const vendors = cart ? [...new Map(cart.items.map((l) => [l.product.vendor.id, l.product.vendor])).values()] : [];

  function setField(key: keyof AddressFields, value: string) {
    setAddress((a) => ({ ...a, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !cart) return;

    const found = checkAddress(address);
    setProblems(found);
    if (found.length > 0) return;

    const deliveryChoices: DeliveryChoices = {};
    for (const vendor of vendors) {
      const method = choices[String(vendor.id)];
      const allowed = methodsFor(cart, vendor.id, offered);
      if (!method || !allowed.includes(method)) {
        setProblems([`Choose a delivery method for ${vendor.name}`]);
        return;
      }
      deliveryChoices[String(vendor.id)] = { method };
    }

    setBusy(true);
    setError(null);
    try {
      const order = await api.orders.checkout(token, {
        delivery: {
          name: address.name.trim(),
          phone: address.phone.trim(),
          line1: address.line1.trim(),
          line2: address.line2.trim() || undefined,
          city: address.city.trim(),
          postalCode: address.postalCode.trim(),
          country: address.country.trim(),
        },
        deliveryChoices,
      });
      setPlaced(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place your order");
      // Reload the cart, so the buyer sees what is still there after a stock change
      const fresh = await api.cart.get(token).catch(() => null);
      if (fresh) setCart(fresh);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return null;
  if (placed) {
    return (
      <main style={pageStyle}>
        <h1>Order placed</h1>
        <p>Order number <strong>{placed.id}</strong></p>
        <p>Total: <strong>{formatPrice(placed.totalCents, placed.currency)}</strong></p>
        <p>Status: <strong>Awaiting payment</strong>. Payment is not connected yet, so this order will not be paid until it is.</p>
        <p><Link to="/">Back to the marketplace</Link></p>
      </main>
    );
  }
  if (cart === null && error === null) return <main style={pageStyle}><p>Loading your checkout�</p></main>;
  if (cart && cart.items.length === 0) {
    return (
      <main style={pageStyle}>
        <h1>Checkout</h1>
        <p>Your cart is empty. <Link to="/">Browse the marketplace</Link></p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>Checkout</h1>
      {error && <p role="alert" style={{ color: "#a00" }}>{error}</p>}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1.5rem" }} noValidate>
        <section style={{ display: "grid", gap: "0.75rem" }}>
          <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Delivery address</h2>
          <label>Full name<input value={address.name} onChange={(e) => setField("name", e.target.value)} style={{ width: "100%" }} /></label>
          <label>Phone<input value={address.phone} onChange={(e) => setField("phone", e.target.value)} style={{ width: "100%" }} /></label>
          <label>Address line 1<input value={address.line1} onChange={(e) => setField("line1", e.target.value)} style={{ width: "100%" }} /></label>
          <label>Address line 2 (optional)<input value={address.line2} onChange={(e) => setField("line2", e.target.value)} style={{ width: "100%" }} /></label>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <label>City<input value={address.city} onChange={(e) => setField("city", e.target.value)} /></label>
            <label>Postal code<input value={address.postalCode} onChange={(e) => setField("postalCode", e.target.value)} /></label>
            <label>Country<input value={address.country} onChange={(e) => setField("country", e.target.value)} /></label>
          </div>
        </section>

        {vendors.map((vendor) => {
          const allowed = cart ? methodsFor(cart, vendor.id, offered) : [];
          return (
            <section key={vendor.id} style={{ display: "grid", gap: "0.5rem" }}>
              <h2 style={{ fontSize: "1.1rem", margin: 0 }}>How {vendor.name} should deliver</h2>
              {allowed.length === 0 ? (
                <p style={{ margin: 0, color: "#555" }}>These items have no delivery option set. Ask the seller to add one.</p>
              ) : (
                allowed.map((m) => (
                  <label key={m}>
                    <input
                      type="radio"
                      name={`vendor-${vendor.id}`}
                      checked={choices[String(vendor.id)] === m}
                      onChange={() => setChoices((c) => ({ ...c, [String(vendor.id)]: m }))}
                    />{" "}
                    {METHOD_LABELS[m]}
                  </label>
                ))
              )}
            </section>
          );
        })}

        {problems.length > 0 && (
          <ul role="alert" style={{ color: "#a00", margin: 0 }}>
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.2rem" }}>Total: {cart ? formatPrice(cart.totalCents, cart.currency) : ""}</strong>
          <button type="submit" disabled={busy || !cart?.allAvailable} style={{ padding: "0.5rem 1.25rem" }}>
            {busy ? "Placing order�" : "Place order"}
          </button>
        </div>
        {cart && !cart.allAvailable && (
          <p style={{ margin: 0, color: "#a00" }}>Some items are no longer available. <Link to="/cart">Review your cart</Link> first.</p>
        )}
      </form>
    </main>
  );
}
