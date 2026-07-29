import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { useCartSync } from "@/hooks/useCartSync";
import { useAccountCartSync } from "@/hooks/useAccountCartSync";
import { AuthProvider } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import Index from "./pages/Index.tsx";
import { AcquisitionSourceGate } from "@/components/AcquisitionSourceGate";

const ProductDetail = lazy(() => import("./pages/ProductDetail.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const Register = lazy(() => import("./pages/Register.tsx"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const Catalog = lazy(() => import("./pages/Catalog.tsx"));
const Cart = lazy(() => import("./pages/Cart.tsx"));
const Clube = lazy(() => import("./pages/Clube.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const MeusPedidos = lazy(() => import("./pages/MeusPedidos.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex min-h-[45vh] items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="h-10 w-10 animate-pulse rounded-2xl bg-primary/15" />
      <span className="text-sm text-muted-foreground">Abrindo página…</span>
    </div>
  </div>
);

const AppContent = () => {
  useCartSync();
  useAccountCartSync();
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
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
          <Route path="/meus-pedidos" element={<MeusPedidos />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
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
