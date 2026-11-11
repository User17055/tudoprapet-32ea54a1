import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { ScrollToTop } from "@/components/ScrollToTop";
import { useCartSync } from "@/hooks/useCartSync";
import { useAccountCartSync } from "@/hooks/useAccountCartSync";
import { AuthProvider } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import Index from "./pages/Index.tsx";
import logo from "@/assets/tpp-logo.svg";

import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { MaintenanceGate } from "@/components/MaintenanceGate";

const ProductDetail = lazy(() => import("./pages/ProductDetail.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const Register = lazy(() => import("./pages/Register.tsx"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const Catalog = lazy(() => import("./pages/Catalog.tsx"));
const Cart = lazy(() => import("./pages/Cart.tsx"));
const Checkout = lazy(() => import("./pages/Checkout.tsx"));

const Admin = lazy(() => import("./pages/Admin.tsx"));
const MeusPedidos = lazy(() => import("./pages/MeusPedidos.tsx"));
const FranchisePayments = lazy(() => import("./pages/FranchisePayments.tsx"));
const FranchiseOrders = lazy(() => import("./pages/FranchiseOrders.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent.tsx"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div
    className="flex min-h-screen items-center justify-center bg-background"
    role="status"
    aria-label="Carregando TudoPraPet"
  >
    <img
      src={logo}
      alt="TudoPraPet"
      className="h-auto w-56 animate-pulse sm:w-64"
    />
  </div>
);

const AppContent = () => {
  useCartSync();
  useAccountCartSync();
  return (
    <BrowserRouter>
      <ScrollToTop />
      <MaintenanceGate>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/catalogo" element={<Catalog />} />
            <Route path="/carrinho" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/product/:handle" element={<ProductDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Register />} />
            <Route path="/esqueci-senha" element={<ForgotPassword />} />
            <Route path="/redefinir-senha" element={<ResetPassword />} />
            <Route path="/perfil" element={<Profile />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/meus-pedidos" element={<MeusPedidos />} />
            <Route path="/pagamentos-franquia" element={<FranchisePayments />} />
            <Route path="/franquia/pedidos" element={<FranchiseOrders />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </MaintenanceGate>
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {/* Só o Sonner. O Toaster do shadcn estava montado mas seu useToast não
          era chamado em lugar nenhum — renderizava sempre vazio. */}
      <Sonner />
      <AppErrorBoundary>
        <AuthProvider>
          <SubscriptionProvider>
            <AppContent />
          </SubscriptionProvider>
        </AuthProvider>
      </AppErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
