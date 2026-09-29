import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Crown,
  ExternalLink,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Package,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OrderSummary {
  id: number;
  name: string;
  created_at: string;
  cancelled_at: string | null;
  financial_status: string | null;
  total_price: number;
  currency: string;
  savings: number;
  order_status_url: string;
}

interface AccountAddress {
  id: string | null;
  label: string;
  recipientName: string;
  address1: string;
  address2: string;
  number: string;
  neighborhood: string;
  city: string;
  provinceCode: string;
  postalCode: string;
  countryCode: "BR";
  isDefaultShipping: boolean;
}

interface AccountContact {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone: string;
}

interface FranchiseFiscalProfile {
  legalName: string;
  tradeName: string;
  cnpj: string;
  stateRegistration: string;
  stateRegistrationIndicator: "contributor" | "exempt" | "non_contributor" | "";
}

const emptyAccountAddress = (): AccountAddress => ({ id: null, label: "Casa", recipientName: "", address1: "", address2: "", number: "", neighborhood: "", city: "", provinceCode: "", postalCode: "", countryCode: "BR", isDefaultShipping: false });
const onlyDigits = (value: string) => value.replace(/\D/g, "");
const maskCep = (value: string) => onlyDigits(value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
const maskCpfCnpj = (value: string) => {
  const raw = onlyDigits(value).slice(0, 14);
  if (raw.length <= 11) return raw.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2");
  return raw.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\/\d{4})(\d)/, "$1-$2");
};
const maskPhone = (value: string) => {
  const raw = onlyDigits(value).slice(0, 11);
  if (raw.length < 3) return raw ? `(${raw}` : "";
  return raw.length <= 10 ? raw.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2") : raw.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};

const formatCurrency = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);

const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  authorized: "Autorizado",
  partially_paid: "Parcialmente pago",
  paid: "Pago",
  partially_refunded: "Parcialmente reembolsado",
  refunded: "Reembolsado",
  voided: "Cancelado",
};

const FINANCIAL_STATUS_STYLES: Record<string, string> = {
  paid: "bg-pet-green/10 text-pet-green border-pet-green/20",
  pending: "bg-secondary/20 text-secondary-foreground border-secondary/30",
  authorized: "bg-secondary/20 text-secondary-foreground border-secondary/30",
  partially_paid: "bg-secondary/20 text-secondary-foreground border-secondary/30",
  refunded: "bg-destructive/10 text-destructive border-destructive/20",
  partially_refunded: "bg-destructive/10 text-destructive border-destructive/20",
  voided: "bg-destructive/10 text-destructive border-destructive/20",
};

const CANCELLED_BADGE = "bg-destructive/10 text-destructive border-destructive/20";

const Profile = () => {
  const { user, loading, logout } = useAuth();
  const { isSubscribed } = useSubscription();
  const { isAdmin } = useIsAdmin();
  const { isFranchisee } = useIsFranchisee();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnToCheckout = searchParams.get("retorno") === "checkout";
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [addresses, setAddresses] = useState<AccountAddress[]>([]);
  const [contact, setContact] = useState<AccountContact>({ name: "", email: "", cpfCnpj: "", mobilePhone: "" });
  const [contactLoading, setContactLoading] = useState(true);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState("");
  const [fiscalProfile, setFiscalProfile] = useState<FranchiseFiscalProfile>({ legalName: "", tradeName: "", cnpj: "", stateRegistration: "", stateRegistrationIndicator: "" });
  const [fiscalBusy, setFiscalBusy] = useState(false);
  const [fiscalError, setFiscalError] = useState("");
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [addressForm, setAddressForm] = useState<AccountAddress>(emptyAccountAddress);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, navigate, user]);

  useEffect(() => {
    if (!user) return;

    setOrdersLoading(true);
    supabase.functions.invoke("customer-orders").then(({ data, error }) => {
      if (!error && data) {
        const all = data.orders || [];
        setOrders(all.slice(0, 4));
      }
      setOrdersLoading(false);
    });
  }, [user]);

  const loadAddresses = useCallback(async () => {
    if (!user) return;
    setAddressesLoading(true);
    const { data, error } = await supabase.functions.invoke("checkout-customer-data", { body: { action: "get" } });
    if (!error && data?.customer) {
      setContact({ name: String(data.customer.name || ""), email: String(data.customer.email || user.email || ""), cpfCnpj: maskCpfCnpj(String(data.customer.cpfCnpj || "")), mobilePhone: maskPhone(String(data.customer.mobilePhone || "")) });
    }
    if (!error && data?.addresses) {
      setAddresses((data.addresses as Record<string, unknown>[]).filter((item) => typeof item.id === "string").map((item) => ({
        id: String(item.id), label: String(item.label || "Casa"), recipientName: String(item.recipient_name || ""),
        address1: String(item.address1 || ""), address2: String(item.address2 || ""), number: String(item.number || ""),
        neighborhood: String(item.neighborhood || ""), city: String(item.city || ""), provinceCode: String(item.province_code || ""),
        postalCode: maskCep(String(item.postal_code || "")), countryCode: "BR", isDefaultShipping: Boolean(item.is_default_shipping),
      })));
    }
    if (!error && data?.franchiseFiscalProfile) {
      const fiscal = data.franchiseFiscalProfile as Record<string, string>;
      setFiscalProfile({
        legalName: String(fiscal.legalName || ""),
        tradeName: String(fiscal.tradeName || ""),
        cnpj: maskCpfCnpj(String(fiscal.cnpj || "")),
        stateRegistration: onlyDigits(String(fiscal.stateRegistration || "")).slice(0, 14),
        stateRegistrationIndicator: (["contributor", "exempt", "non_contributor"].includes(fiscal.stateRegistrationIndicator)
          ? fiscal.stateRegistrationIndicator
          : "") as FranchiseFiscalProfile["stateRegistrationIndicator"],
      });
    }
    setContactLoading(false);
    setAddressesLoading(false);
  }, [user]);

  useEffect(() => { void loadAddresses(); }, [loadAddresses]);

  useEffect(() => {
    const cep = onlyDigits(addressForm.postalCode);
    if (!addressFormOpen || cep.length !== 8) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCepLoading(true); setAddressError("");
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal });
        const data = await response.json() as { erro?: boolean; logradouro?: string; complemento?: string; bairro?: string; localidade?: string; uf?: string };
        if (!response.ok || data.erro) { setAddressError("CEP não encontrado. Confira ou preencha manualmente."); return; }
        setAddressForm((current) => ({ ...current, address1: data.logradouro || current.address1, address2: current.address2 || data.complemento || "", neighborhood: data.bairro || current.neighborhood, city: data.localidade || current.city, provinceCode: data.uf || current.provinceCode }));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setAddressError("Não foi possível consultar o CEP. Preencha manualmente.");
      } finally { setCepLoading(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [addressForm.postalCode, addressFormOpen]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const firstName = user.user_metadata?.first_name || "";
  const lastName = user.user_metadata?.last_name || "";
  const fullName =
    `${firstName} ${lastName}`.trim() || user.email?.split("@")[0] || "Cliente";
  const initials = (
    (firstName?.[0] || user.email?.[0] || "C") + (lastName?.[0] || "")
  ).toUpperCase();

  const handleLogout = async () => {
    await logout();
    toast.success("Sessão encerrada.");
    navigate("/");
  };

  const openNewAddress = () => {
    setAddressForm({ ...emptyAccountAddress(), recipientName: fullName });
    setAddressError("");
    setAddressFormOpen(true);
  };

  const editAddress = (address: AccountAddress) => {
    setAddressForm({ ...address });
    setAddressError("");
    setAddressFormOpen(true);
  };

  const saveAddress = async () => {
    const required = addressForm.label.trim() && addressForm.recipientName.trim() && onlyDigits(addressForm.postalCode).length === 8 && addressForm.address1.trim() && addressForm.number.trim() && addressForm.neighborhood.trim() && addressForm.city.trim() && /^[A-Za-z]{2}$/.test(addressForm.provinceCode);
    if (!required) { setAddressError("Preencha todos os campos obrigatórios do endereço."); return; }
    setAddressBusy(true); setAddressError("");
    const { error } = await supabase.functions.invoke("checkout-customer-data", { body: {
      action: "save_address", addressId: addressForm.id, label: addressForm.label, recipientName: addressForm.recipientName,
      address: addressForm, defaultShipping: addressForm.isDefaultShipping || addresses.length === 0, defaultBilling: addressForm.isDefaultShipping || addresses.length === 0,
    } });
    setAddressBusy(false);
    if (error) { setAddressError("Não foi possível salvar o endereço. Tente novamente."); return; }
    toast.success("Endereço salvo."); setAddressFormOpen(false); await loadAddresses();
  };

  const deleteAddress = async (addressId: string) => {
    const { error } = await supabase.functions.invoke("checkout-customer-data", { body: { action: "delete_address", addressId } });
    if (error) { toast.error("Não foi possível remover o endereço."); return; }
    toast.success("Endereço removido."); await loadAddresses();
  };

  const saveContact = async () => {
    const document = isFranchisee ? fiscalProfile.cnpj : contact.cpfCnpj;
    if (contact.name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) || ![11, 14].includes(onlyDigits(document).length) || ![10, 11].includes(onlyDigits(contact.mobilePhone).length)) {
      setContactError("Preencha nome, e-mail, CPF ou CNPJ e celular corretamente."); return;
    }
    setContactBusy(true); setContactError("");
    const { data, error } = await supabase.functions.invoke("checkout-customer-data", { body: { action: "save_contact", customer: { ...contact, cpfCnpj: document }, billingSameAsShipping: true } });
    setContactBusy(false);
    if (error || data?.error) { setContactError(data?.error || "Não foi possível salvar seus dados. Confira o CPF ou CNPJ."); return; }
    toast.success("Dados pessoais salvos.");
  };

  const saveFiscalProfile = async () => {
    if (fiscalProfile.legalName.trim().length < 2 || onlyDigits(fiscalProfile.cnpj).length !== 14 || !fiscalProfile.stateRegistrationIndicator) {
      setFiscalError("Preencha razão social, CNPJ e situação da inscrição estadual."); return;
    }
    if (fiscalProfile.stateRegistrationIndicator === "contributor" && !/^\d{2,14}$/.test(onlyDigits(fiscalProfile.stateRegistration))) {
      setFiscalError("Informe a inscrição estadual com 2 a 14 dígitos."); return;
    }
    setFiscalBusy(true); setFiscalError("");
    const { data, error } = await supabase.functions.invoke("checkout-customer-data", { body: {
      action: "save_franchise_fiscal",
      ...fiscalProfile,
    } });
    setFiscalBusy(false);
    if (error || data?.error) { setFiscalError(data?.error || "Não foi possível salvar os dados fiscais."); return; }
    setContact((current) => ({ ...current, cpfCnpj: fiscalProfile.cnpj }));
    toast.success("Dados fiscais da franquia salvos.");
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header />

      <main className="flex-1">
        {/* Faixa de título no padrão do catálogo */}
        <div className="border-b border-border bg-white">
          <div className="container mx-auto py-5 sm:py-8 md:py-10">
            <Breadcrumb className="mb-4 sm:mb-6">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/">Início</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Minha conta</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[hsl(218_70%_15%)] font-display text-base font-bold text-white sm:h-16 sm:w-16 sm:text-xl">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate font-display font-900 text-xl text-foreground sm:text-2xl md:text-3xl">
                      Olá, {firstName || fullName}
                    </h1>
                    {isFranchisee ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-800">
                        Franquia
                      </span>
                    ) : isSubscribed ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                        <Crown className="h-3.5 w-3.5" /> Assinante
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                        Cliente
                      </span>
                    )}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                    <Mail className="h-4 w-4 shrink-0" />
                    {user.email}
                  </p>
                </div>
              </div>

              <Button
                variant="ghost"
                onClick={handleLogout}
                className="btn-bounce w-fit gap-2 self-start rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-auto"
              >
                <LogOut className="h-4 w-4" /> Sair
              </Button>
            </div>
          </div>
        </div>

        <div className="container mx-auto py-5 sm:py-8">
          <nav className="mb-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Atalhos da conta">
            <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full"><Link to="/meus-pedidos"><Package className="mr-1.5 h-4 w-4" />Meus pedidos</Link></Button>
            {isFranchisee && <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full"><Link to="/pagamentos-franquia"><WalletCards className="mr-1.5 h-4 w-4" />Pagamentos</Link></Button>}
            <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full"><Link to="/carrinho"><ShoppingBag className="mr-1.5 h-4 w-4" />Carrinho</Link></Button>
            <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full"><Link to="/catalogo">Comprar novamente</Link></Button>
            {isAdmin && <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full"><Link to="/admin"><ShieldCheck className="mr-1.5 h-4 w-4" />Painel admin</Link></Button>}
          </nav>

          <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
            {returnToCheckout && <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-foreground">Complete o cadastro para finalizar sua compra</p><p className="text-sm text-muted-foreground">Depois de salvar seus dados e endereço, volte ao checkout.</p></div><Button asChild className="shrink-0"><Link to="/checkout">Voltar ao checkout</Link></Button></div>}
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-4 md:px-6">
                <h2 className="font-display text-lg font-bold text-foreground">Meus dados</h2>
                <p className="text-sm text-muted-foreground">Usados na nota fiscal, cobrança e identificação dos seus pedidos.</p>
              </div>
              <div className="p-4 md:p-5">
                {contactLoading ? <div className="h-24 animate-pulse rounded-xl bg-muted/60" /> : <><div className="grid gap-3 sm:grid-cols-2"><ProfileField label="Nome completo"><Input autoComplete="name" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /></ProfileField><ProfileField label="E-mail para nota e comprovante"><Input type="email" autoComplete="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></ProfileField><ProfileField label={isFranchisee ? "CNPJ (edite nos dados fiscais)" : "CPF ou CNPJ"}><Input disabled={isFranchisee} inputMode="numeric" maxLength={18} placeholder="000.000.000-00" value={isFranchisee ? fiscalProfile.cnpj : contact.cpfCnpj} onChange={(event) => setContact({ ...contact, cpfCnpj: maskCpfCnpj(event.target.value) })} /></ProfileField><ProfileField label="Celular"><Input inputMode="tel" autoComplete="tel" maxLength={15} placeholder="(00) 00000-0000" value={contact.mobilePhone} onChange={(event) => setContact({ ...contact, mobilePhone: maskPhone(event.target.value) })} /></ProfileField></div>{contactError && <p className="mt-3 text-sm font-medium text-destructive">{contactError}</p>}<Button type="button" className="mt-4 w-full sm:w-auto" disabled={contactBusy} onClick={() => void saveContact()}>{contactBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar meus dados</Button></>}
              </div>
            </section>
            {isFranchisee && <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-4 md:px-6">
                <h2 className="font-display text-lg font-bold text-foreground">Dados fiscais da franquia</h2>
                <p className="text-sm text-muted-foreground">Obrigatórios para emitir a NF-e e concluir compras da franquia.</p>
              </div>
              <div className="p-4 md:p-5">
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Para comprar para <strong>revenda</strong>, selecione contribuinte de ICMS e informe a inscrição estadual. O nome fantasia é opcional.</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileField label="Razão social *"><Input value={fiscalProfile.legalName} onChange={(event) => setFiscalProfile({ ...fiscalProfile, legalName: event.target.value })} /></ProfileField>
                  <ProfileField label="Nome fantasia"><Input placeholder="Opcional" value={fiscalProfile.tradeName} onChange={(event) => setFiscalProfile({ ...fiscalProfile, tradeName: event.target.value })} /></ProfileField>
                  <ProfileField label="CNPJ *"><Input inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00" value={fiscalProfile.cnpj} onChange={(event) => setFiscalProfile({ ...fiscalProfile, cnpj: maskCpfCnpj(event.target.value) })} /></ProfileField>
                  <ProfileField label="Situação da IE *"><Select value={fiscalProfile.stateRegistrationIndicator} onValueChange={(value: FranchiseFiscalProfile["stateRegistrationIndicator"]) => setFiscalProfile({ ...fiscalProfile, stateRegistrationIndicator: value, stateRegistration: value === "contributor" ? fiscalProfile.stateRegistration : "" })}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="contributor">Contribuinte de ICMS</SelectItem><SelectItem value="exempt">Isento</SelectItem><SelectItem value="non_contributor">Não contribuinte</SelectItem></SelectContent></Select></ProfileField>
                  {fiscalProfile.stateRegistrationIndicator === "contributor" && <ProfileField label="Inscrição estadual *"><Input inputMode="numeric" maxLength={14} value={fiscalProfile.stateRegistration} onChange={(event) => setFiscalProfile({ ...fiscalProfile, stateRegistration: onlyDigits(event.target.value).slice(0, 14) })} /></ProfileField>}
                </div>
                {fiscalError && <p className="mt-3 text-sm font-medium text-destructive">{fiscalError}</p>}
                <Button type="button" className="mt-4 w-full sm:w-auto" disabled={fiscalBusy} onClick={() => void saveFiscalProfile()}>{fiscalBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar dados fiscais</Button>
              </div>
            </section>}
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-col items-start gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
                <div>
                  <h2 className="font-display text-lg font-bold text-foreground">Meus endereços</h2>
                  <p className="text-sm text-muted-foreground">Use no checkout sem preencher tudo novamente.</p>
                </div>
                <Button type="button" size="sm" className="w-full shrink-0 rounded-full sm:w-auto" onClick={openNewAddress}><Plus className="mr-1.5 h-4 w-4" />Adicionar endereço</Button>
              </div>
              <div className="p-4 md:p-5">
                {addressesLoading ? <div className="h-20 animate-pulse rounded-xl bg-muted/60" /> : addresses.length === 0 && !addressFormOpen ? <div className="flex flex-col items-center py-8 text-center"><MapPin className="h-9 w-9 text-muted-foreground" /><p className="mt-3 font-bold">Nenhum endereço cadastrado</p><p className="mt-1 text-sm text-muted-foreground">Cadastre agora para agilizar sua próxima compra.</p><Button type="button" variant="outline" className="mt-4 rounded-full" onClick={openNewAddress}>Cadastrar endereço</Button></div> : <div className="grid gap-3 sm:grid-cols-2">{addresses.map((address) => <article key={address.id} className="relative min-w-0 rounded-xl border border-border p-4"><div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><MapPin className="h-4 w-4" /></span><div className="min-w-0 flex-1 break-words"><div className="flex flex-wrap items-center gap-2"><strong>{address.label}</strong>{address.isDefaultShipping && <Badge variant="outline" className="border-pet-green/30 bg-pet-green/10 text-pet-green">Padrão</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{address.address1}, {address.number}{address.address2 ? `, ${address.address2}` : ""}</p><p className="text-sm text-muted-foreground">{address.neighborhood} • {address.city}/{address.provinceCode} • {address.postalCode}</p></div></div><div className="mt-3 flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => editAddress(address)}>Editar</Button>{address.id && <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => void deleteAddress(address.id!)} aria-label={`Remover endereço ${address.label}`}><Trash2 className="h-4 w-4" /></Button>}</div></article>)}</div>}
                {addressFormOpen && <div className="mt-4 rounded-xl border border-primary/20 bg-muted/20 p-4"><div className="mb-4 flex items-center justify-between"><h3 className="font-bold">{addressForm.id ? "Editar endereço" : "Novo endereço"}</h3><Button type="button" variant="ghost" size="sm" onClick={() => setAddressFormOpen(false)}>Cancelar</Button></div><div className="grid gap-3 sm:grid-cols-2"><ProfileField label="Nome do endereço"><Input placeholder="Casa, Trabalho..." value={addressForm.label} onChange={(event) => setAddressForm({ ...addressForm, label: event.target.value })} /></ProfileField><ProfileField label="Destinatário"><Input value={addressForm.recipientName} onChange={(event) => setAddressForm({ ...addressForm, recipientName: event.target.value })} /></ProfileField><ProfileField label="CEP"><div className="relative"><Input placeholder="00000-000" maxLength={9} inputMode="numeric" value={addressForm.postalCode} onChange={(event) => setAddressForm({ ...addressForm, postalCode: maskCep(event.target.value) })} />{cepLoading && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-primary" />}</div></ProfileField><ProfileField label="Rua"><Input value={addressForm.address1} onChange={(event) => setAddressForm({ ...addressForm, address1: event.target.value })} /></ProfileField><ProfileField label="Número"><Input value={addressForm.number} onChange={(event) => setAddressForm({ ...addressForm, number: event.target.value })} /></ProfileField><ProfileField label="Complemento"><Input placeholder="Opcional" value={addressForm.address2} onChange={(event) => setAddressForm({ ...addressForm, address2: event.target.value })} /></ProfileField><ProfileField label="Bairro"><Input value={addressForm.neighborhood} onChange={(event) => setAddressForm({ ...addressForm, neighborhood: event.target.value })} /></ProfileField><ProfileField label="Cidade"><Input value={addressForm.city} onChange={(event) => setAddressForm({ ...addressForm, city: event.target.value })} /></ProfileField><ProfileField label="UF"><Input maxLength={2} value={addressForm.provinceCode} onChange={(event) => setAddressForm({ ...addressForm, provinceCode: event.target.value.toUpperCase() })} /></ProfileField></div><label className="mt-4 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={addressForm.isDefaultShipping} onChange={(event) => setAddressForm({ ...addressForm, isDefaultShipping: event.target.checked })} />Usar como endereço padrão</label>{addressError && <p className="mt-3 text-sm font-medium text-destructive">{addressError}</p>}<Button type="button" className="mt-4 w-full sm:w-auto" disabled={addressBusy} onClick={() => void saveAddress()}>{addressBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar endereço</Button></div>}
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-col items-start gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
                <div>
                  <h2 className="font-display text-lg font-bold text-foreground">
                    Pedidos recentes
                  </h2>
                  <p className="text-sm text-muted-foreground">Suas últimas compras.</p>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="btn-bounce w-full shrink-0 justify-center rounded-full text-primary sm:w-auto"
                >
                  <Link to="/meus-pedidos">Ver todos</Link>
                </Button>
              </div>

              <div className="p-4 md:p-5">
                {ordersLoading ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((item) => (
                      <div
                        key={item}
                        className="h-[72px] animate-pulse rounded-xl bg-muted/60"
                      />
                    ))}
                  </div>
                ) : orders.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <ShoppingBag className="h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 font-display font-bold text-foreground">
                      Nenhum pedido ainda
                    </h3>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                      Seus pedidos aparecerão aqui depois da primeira compra.
                    </p>
                    <Button asChild className="btn-bounce mt-5 rounded-full">
                      <Link to="/catalogo">Explorar produtos</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {orders.map((order) => {
                      const isInactive =
                        Boolean(order.cancelled_at) ||
                        order.financial_status === "refunded";
                      const badgeClass = order.cancelled_at
                        ? CANCELLED_BADGE
                        : FINANCIAL_STATUS_STYLES[order.financial_status || ""] || "";
                      const badgeLabel = order.cancelled_at
                        ? "Cancelado"
                        : FINANCIAL_STATUS_LABELS[order.financial_status || ""] ||
                          "Realizado";

                      return (
                        <article
                          key={order.id}
                          className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <Package className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate font-display text-sm font-bold text-foreground">
                                  Pedido {order.name}
                                </h3>
                                {badgeClass && (
                                  <Badge variant="outline" className={badgeClass}>
                                    {badgeLabel}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {new Date(order.created_at).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-4 pl-[56px] sm:justify-end sm:pl-0">
                            <div className="text-right">
                              <p
                                className={`whitespace-nowrap font-display text-sm font-bold ${
                                  isInactive
                                    ? "text-muted-foreground line-through"
                                    : "text-foreground"
                                }`}
                              >
                                {formatCurrency(order.total_price, order.currency)}
                              </p>
                              {order.savings > 0 && !isInactive && (
                                <p className="text-xs text-pet-green">
                                  Economia de{" "}
                                  {formatCurrency(order.savings, order.currency)}
                                </p>
                              )}
                            </div>

                            {order.order_status_url && (
                              <a
                                href={order.order_status_url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Acompanhar pedido ${order.name}`}
                                className="btn-bounce inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

function ProfileField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-sm">{label}</Label>{children}</div>;
}

export default Profile;
