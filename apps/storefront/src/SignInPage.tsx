import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "./api";
import { useSession } from "./session";

const pageStyle = { maxWidth: 420, margin: "0 auto", padding: "1rem", fontFamily: "system-ui, sans-serif" };

export default function SignInPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.accounts.buyer.login({ email, password });
      signIn(result.token, email);
      navigate("/cart");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={pageStyle}>
      <h1>Sign in</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem" }}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: "100%" }} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: "100%" }} />
        </label>
        <button type="submit" disabled={busy} style={{ justifySelf: "start", padding: "0.5rem 1.25rem" }}>
          {busy ? "Signing in�" : "Sign in"}
        </button>
      </form>
      {error && <p role="alert" style={{ color: "#a00" }}>{error}</p>}
      <p><Link to="/">Back to the marketplace</Link></p>
    </main>
  );
}
