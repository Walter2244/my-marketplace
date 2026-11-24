import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import ProductPage from "./ProductPage";
import SignInPage from "./SignInPage";
import CartPage from "./CartPage";
import CheckoutPage from "./CheckoutPage";
import { SessionProvider } from "./session";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/products/:id" element={<ProductPage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>
);
