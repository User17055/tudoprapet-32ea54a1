import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCartSync } from "@/hooks/useCartSync";
import { AuthProvider } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import Index from "./pages/Index.tsx";
import ProductDetail from "./pages/ProductDetail.tsx";
import Login from "./pages/Login.tsx";
import Register from "./pages/Register.tsx";
import ForgotPassword from "./pages/ForgotPassword.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import Profile from "./pages/Profile.tsx";
import Catalog from "./pages/Catalog.tsx";
import Cart from "./pages/Cart.tsx";
import Clube from "./pages/Clube.tsx";
import Admin from "./pages/Admin.tsx";
import MeusPedidos from "./pages/MeusPedidos.tsx";
import NotFound from "./pages/NotFound.tsx";
import { AcquisitionSourceGate } from "@/components/AcquisitionSourceGate";

const queryClient = new QueryClient();

const AppContent = () => {
  useCartSync();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/catalogo" element={<Catalog />} />
        <Route path="/carrinho" element={<Cart />} />
        <Route path="/product/:handle" element={<ProductDetail />} />
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
        <Route path="/esqueci-senha" element={<ForgotPassword />} />
        <Route path="/redefinir-senha" element={<ResetPassword />} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="/clube" element={<Clube />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/retirada" element={<Retirada />} />
        <Route path="/meus-pedidos" element={<MeusPedidos />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <AcquisitionSourceGate />
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <SubscriptionProvider>
          <AppContent />
        </SubscriptionProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
