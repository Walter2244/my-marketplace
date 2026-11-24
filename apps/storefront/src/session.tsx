import { createContext, useContext, useState, type ReactNode } from "react";

// The buyer's token lives in memory only, so it's gone when the page is closed.
type Session = { token: string | null; email: string | null; signIn: (token: string, email: string) => void; signOut: () => void };

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const value: Session = {
    token,
    email,
    signIn: (t, e) => { setToken(t); setEmail(e); },
    signOut: () => { setToken(null); setEmail(null); },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
