import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  CreditCard,
  CircleHelp,
  Loader2,
  LockKeyhole,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  Store,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { gsap } from "gsap";
import logo from "@/assets/tpp-logo.svg";
import bravectoImage from "@/assets/bravecto.jpg";
import defenzaImage from "@/assets/defenza.jpg";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  installmentLabel,
  installmentOptions,
  installmentPlan,
  maxInstallmentsFor,
  type InstallmentPlan,
} from "@/lib/installments";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { useFranchisePrices } from "@/hooks/useFranchisePrices";
import { supabase } from "@/integrations/supabase/client";
import {
  customCheckoutEnabled,
  readCheckoutLaunch,
} from "@/lib/customCheckout";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { useCartStore, type CartItem } from "@/stores/cartStore";
import { toast } from "sonner";

type Customer = {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone: string;
};
type Address = {
  address1: string;
  address2: string;
  number: string;
  neighborhood: string;
  city: string;
  provinceCode: string;
  postalCode: string;
  countryCode: "BR";
};
type SavedAddress = Address & {
  id: string | null;
  label: string;
  recipientName: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
};
type SavedPayment = {
  id: string;
  brand: string | null;
  lastFour: string;
  holderName: string | null;
  isDefault: boolean;
};
type ShippingOption = {
  handle: string;
  code: string | null;
  title: string;
  description: string | null;
  amount: number;
  currencyCode: string;
};
type ShippingSummaryOverride = {
  title: string;
  amount: number;
};
type SummaryItem = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  imageUrl?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};
type CheckoutSummary = {
  subtotal: number;
  discount: number;
  serviceFee: number;
  shippingAmount?: number;
  shippingMethod?: string;
  shippingCode?: string;
  total: number;
  items: SummaryItem[];
};
type PaymentResult = {
  status: string;
  pixQrCode?: string | null;
  pixCopyPaste?: string | null;
  expiresAt?: string | null;
  invoiceUrl?: string | null;
};

const ACTIVE_KEY = "tpp_checkout_active";
const SERVICE_FEE = 3;
const PICKUP_STORE_ADDRESS = String(
  import.meta.env.VITE_PICKUP_STORE_ADDRESS || "",
).trim();
const PICKUP_STORE_HOURS = String(
  import.meta.env.VITE_PICKUP_STORE_HOURS || "",
).trim();
const emptyAddress = (): Address => ({
  address1: "",
  address2: "",
  number: "",
  neighborhood: "",
  city: "",
  provinceCode: "",
  postalCode: "",
  countryCode: "BR",
});
const PREVIEW_CUSTOMER: Customer = {
  name: "Maria da Silva",
  email: "maria@exemplo.com",
  cpfCnpj: "123.456.789-09",
  mobilePhone: "(18) 99999-9999",
};
const PREVIEW_ADDRESS: SavedAddress = {
  ...emptyAddress(),
  id: "preview-address",
  label: "Casa",
  recipientName: "Maria da Silva",
  address1: "Rua Rubens Gasque Jordan",
  number: "80",
  neighborhood: "Jardim Cambuci",
  city: "Presidente Prudente",
  provinceCode: "SP",
  postalCode: "19045-060",
  isDefaultShipping: true,
  isDefaultBilling: true,
};
const PREVIEW_SUMMARY: CheckoutSummary = {
  subtotal: 159.8,
  discount: 20,
  serviceFee: SERVICE_FEE,
  shippingAmount: 0,
  total: 142.8,
  items: [
    {
      variantId: "preview-racao",
      productTitle: "Bravecto Antipulgas e Carrapatos",
      variantTitle: "Cães de 10 a 20 kg",
      imageUrl: bravectoImage,
      quantity: 1,
      unitPrice: 139.9,
      lineTotal: 139.9,
    },
    {
      variantId: "preview-petisco",
      productTitle: "Defenza Antipulgas",
      variantTitle: "Dose única",
      imageUrl: defenzaImage,
      quantity: 1,
      unitPrice: 19.9,
      lineTotal: 19.9,
    },
  ],
};
const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value) || 0,
  );
const digits = (value: string) => value.replace(/\D/g, "");
const formatCep = (value: string) =>
  digits(value)
    .slice(0, 8)
    .replace(/^(\d{5})(\d)/, "$1-$2");
const validAddressValue = (value: Address) =>
  Boolean(
    value.address1 &&
    value.number &&
    value.neighborhood &&
    value.city &&
    /^[A-Za-z]{2}$/.test(value.provinceCode) &&
    digits(value.postalCode).length === 8,
  );
const errorText = (error: unknown, fallback: string) =>
  error && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message || fallback)
    : fallback;

const edgeFunctionErrorText = async (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: unknown; message?: unknown };
        const detail = payload.error || payload.message;
        if (typeof detail === "string" && detail.trim()) return detail.trim();
      } catch {
        // Respostas sem JSON usam a mensagem padrão abaixo.
      }
    }
  }
  return errorText(error, fallback);
};

export default function Checkout() {
  const navigate = useNavigate();
  const previewMode =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "1";
  const launch = useMemo(() => readCheckoutLaunch(), []);
  const { user, loading: authLoading } = useAuth();
  const {
    items: cartItems,
    addItem,
    clearCart,
    updateQuantity,
    removeItem,
    isLoading: cartBusy,
  } = useCartStore();
  const items = previewMode
    ? PREVIEW_SUMMARY.items.map(({ variantId, quantity }) => ({
        variantId,
        quantity,
      }))
    : launch?.source === "buy_now"
      ? launch.items
      : cartItems.map(({ variantId, quantity }) => ({ variantId, quantity }));
  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState<Customer>(
    previewMode
      ? PREVIEW_CUSTOMER
      : { name: "", email: "", cpfCnpj: "", mobilePhone: "" },
  );
  const [deliveryMode, setDeliveryMode] = useState<"pick_up" | "shipping">(
    "shipping",
  );
  const [address, setAddress] = useState<Address>(emptyAddress);
  const [billingAddress, setBillingAddress] = useState<Address>(emptyAddress);
  const [searchedCep, setSearchedCep] = useState("");
  const [billingSame] = useState(true);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>(
    previewMode ? [PREVIEW_ADDRESS] : [],
  );
  const [addressLabel, setAddressLabel] = useState("Casa");
  const [customerDataLoading, setCustomerDataLoading] = useState(!previewMode);
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const [addressDraft, setAddressDraft] = useState<Address>(emptyAddress);
  const [addressDraftLabel, setAddressDraftLabel] = useState("");
  const [addressDraftBusy, setAddressDraftBusy] = useState(false);
  const [addressDraftError, setAddressDraftError] = useState("");
  const [addressRegistrationRequired, setAddressRegistrationRequired] =
    useState(false);
  const [resumeAfterAddressSave, setResumeAfterAddressSave] = useState(false);
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [shippingHandle, setShippingHandle] = useState("");
  const [shippingAvailabilityLoading, setShippingAvailabilityLoading] =
    useState(false);
  const [shippingQuoteKey, setShippingQuoteKey] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "credit_card">(
    "pix",
  );
  const [savedPayments, setSavedPayments] = useState<SavedPayment[]>([]);
  const [savedPaymentId, setSavedPaymentId] = useState("");
  const [installments, setInstallments] = useState(1);
  const [saveCard, setSaveCard] = useState(true);
  const [card, setCard] = useState({
    holderName: "",
    number: "",
    expiryMonth: "",
    expiryYear: "",
    ccv: "",
  });
  const [isFranchisee, setIsFranchisee] = useState(false);
  const [credentials, setCredentials] = useState<{
    sessionId: string;
    accessToken: string;
  } | null>(null);
  const [summary, setSummary] = useState<CheckoutSummary | null>(
    previewMode ? PREVIEW_SUMMARY : null,
  );
  const [payment, setPayment] = useState<PaymentResult | null>(null);
  const { getSubscriberPrice: cardSubscriberPrice } = useSubscriberPrices();
  const { getFranchisePrice: cardFranchisePrice } = useFranchisePrices();
  // Sem sessão de checkout ainda, o desconto de assinante/franquia é calculado
  // no cliente — sem isso o parcelamento usava o valor cheio dos produtos.
  const localCartDiscount = cartItems.reduce((acc, item) => {
    const catalogPrice = Number(item.price.amount);
    const special =
      cardFranchisePrice(item.variantId) ?? cardSubscriberPrice(item.variantId);
    if (special === null || special >= catalogPrice) return acc;
    return acc + (catalogPrice - special) * item.quantity;
  }, 0);
  const cardBaseTotal = Math.max(
    0,
    (summary?.subtotal ??
      cartItems.reduce(
        (acc, item) => acc + Number(item.price.amount) * item.quantity,
        0,
      )) -
      (summary?.discount ?? localCartDiscount) +
      (deliveryMode === "pick_up"
        ? 0
        : (shippingOptions.find((option) => option.handle === shippingHandle)
            ?.amount ?? summary?.shippingAmount ?? 0)) +
      (summary?.serviceFee ?? SERVICE_FEE),
  );
  const cardPlans = installmentOptions(cardBaseTotal);
  const selectedInstallments = Math.min(
    installments,
    maxInstallmentsFor(cardBaseTotal),
  );
  const selectedCardPlan =
    paymentMethod === "credit_card" && !isFranchisee
      ? cardPlans.find((plan) => plan.installments === selectedInstallments) ??
        null
      : null;
  const [busy, setBusy] = useState(false);
  const [cancellingPix, setCancellingPix] = useState(false);
  const [cardFailure, setCardFailure] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [recommended, setRecommended] = useState<ShopifyProduct[]>([]);
  const [recommendedLoading, setRecommendedLoading] = useState(true);
  const [validationAttempt, setValidationAttempt] = useState<{
    step: number;
    id: number;
  } | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  const stepContentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (
      !pageRef.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-checkout-enter]",
        { autoAlpha: 0, y: 18 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.55,
          stagger: 0.08,
          ease: "power2.out",
        },
      );
    }, pageRef);
    return () => context.revert();
  }, []);

  useLayoutEffect(() => {
    if (
      !stepContentRef.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const context = gsap.context(() => {
      gsap.fromTo(
        stepContentRef.current,
        { autoAlpha: 0, x: step === 0 ? 0 : 22 },
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.38,
          ease: "power2.out",
          clearProps: "transform",
        },
      );
      gsap.fromTo(
        "[data-step-item]",
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.3,
          stagger: 0.045,
          ease: "power1.out",
          delay: 0.06,
        },
      );
    }, stepContentRef);
    return () => context.revert();
  }, [step]);

  useLayoutEffect(() => {
    if (!validationAttempt || !stepContentRef.current) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const invalidFields = stepContentRef.current.querySelectorAll(
      '[data-invalid="true"]',
    );
    if (reducedMotion) return;
    const fieldsAnimation = invalidFields.length
      ? gsap.fromTo(
          invalidFields,
          { x: -5 },
          {
            x: 5,
            duration: 0.065,
            repeat: 5,
            yoyo: true,
            ease: "power1.inOut",
            clearProps: "transform",
          },
        )
      : null;
    return () => { fieldsAnimation?.kill(); };
  }, [validationAttempt]);

  useEffect(() => {
    if (previewMode) return;
    if (!user) {
      setCustomerDataLoading(false);
      return;
    }
    supabase.functions
      .invoke("checkout-customer-data", { body: { action: "get" } })
      .then(({ data }) => {
        if (!data) return;
        if (data.customer)
          setCustomer({
            name: data.customer.name || "",
            email: data.customer.email || user.email || "",
            cpfCnpj: data.customer.cpfCnpj || "",
            mobilePhone: data.customer.mobilePhone || "",
          });
        const addresses: SavedAddress[] = (data.addresses || []).map(
          (item: Record<string, unknown>) => ({
            id: typeof item.id === "string" ? item.id : null,
            label: String(item.label || "Casa"),
            recipientName: String(item.recipient_name || ""),
            address1: String(item.address1 || ""),
            address2: String(item.address2 || ""),
            number: String(item.number || ""),
            neighborhood: String(item.neighborhood || ""),
            city: String(item.city || ""),
            provinceCode: String(item.province_code || ""),
            postalCode: String(item.postal_code || ""),
            countryCode: "BR",
            isDefaultShipping: Boolean(item.is_default_shipping),
            isDefaultBilling: Boolean(item.is_default_billing),
          }),
        );
        setSavedAddresses(addresses);
        const methods: SavedPayment[] = (data.paymentMethods || []).map(
          (item: Record<string, unknown>) => ({
            id: String(item.id),
            brand: item.brand ? String(item.brand) : null,
            lastFour: String(item.last_four),
            holderName: item.holder_name ? String(item.holder_name) : null,
            isDefault: Boolean(item.is_default),
          }),
        );
        setSavedPayments(methods);
        setSavedPaymentId(
          (methods.find((item) => item.isDefault) || methods[0])?.id || "",
        );
        setIsFranchisee(Boolean(data.isFranchisee));
      })
      .finally(() => setCustomerDataLoading(false));
  }, [previewMode, user]);

  useEffect(() => {
    const rawCep = digits(searchedCep);
    if (rawCep.length !== 8) {
      setAddress(emptyAddress());
      setBillingAddress(emptyAddress());
      return;
    }
    const match = savedAddresses.find(
      (item) => digits(item.postalCode) === rawCep,
    );
    if (match) {
      setAddress(match);
      setBillingAddress(match);
      setAddressLabel(match.label);
    } else {
      setAddress({ ...emptyAddress(), postalCode: formatCep(rawCep) });
      setBillingAddress({ ...emptyAddress(), postalCode: formatCep(rawCep) });
    }
  }, [savedAddresses, searchedCep]);

  useEffect(() => {
    setAddressRegistrationRequired(false);
  }, [searchedCep]);

  useEffect(() => {
    if (!addressSheetOpen || digits(addressDraft.postalCode).length !== 8)
      return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `https://viacep.com.br/ws/${digits(addressDraft.postalCode)}/json/`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as {
          erro?: boolean;
          logradouro?: string;
          complemento?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
        };
        if (!response.ok || data.erro)
          return setAddressDraftError(
            "CEP não encontrado. Confira o CEP e preencha o endereço.",
          );
        setAddressDraft((current) => ({
          ...current,
          address1: data.logradouro || current.address1,
          address2: current.address2 || data.complemento || "",
          neighborhood: data.bairro || current.neighborhood,
          city: data.localidade || current.city,
          provinceCode: data.uf || current.provinceCode,
        }));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setAddressDraftError(
            "Não foi possível consultar o CEP agora. Preencha o endereço manualmente.",
          );
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [addressDraft.postalCode, addressSheetOpen]);

  useEffect(() => {
    let active = true;
    void fetchAllShopifyProducts()
      .then((products) => {
        if (!active) return;
        const cartVariantIds = new Set(items.map((item) => item.variantId));
        setRecommended(
          products
            .filter((product) =>
              product.node.variants.edges.some(
                ({ node }) =>
                  node.availableForSale && !cartVariantIds.has(node.id),
              ),
            )
            .slice(0, 4),
        );
        setRecommendedLoading(false);
      })
      .catch(() => {
        if (active) {
          setRecommended([]);
          setRecommendedLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // O carregamento é feito uma vez para não refazer a consulta a cada alteração local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (previewMode) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null");
      if (stored?.sessionId && stored?.accessToken) {
        setCredentials({
          sessionId: stored.sessionId,
          accessToken: stored.accessToken,
        });
        if (stored.summary) setSummary(stored.summary);
        if (stored.payment) {
          setPayment(stored.payment);
          setStep(4);
        }
      }
    } catch {
      /* checkout local inválido */
    }
  }, [previewMode]);

  useEffect(() => {
    if (!credentials || confirmed || previewMode) return;
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      const { data } = await supabase.functions.invoke("checkout-status", {
        body: credentials,
      });
      checking = false;
      if (stopped || !data) return;
      if (data.summary) {
        setSummary(data.summary);
      }
      if (data.payment) {
        setPayment((current) =>
          current
            ? {
                ...current,
                status: data.payment.status || current.status,
                expiresAt: data.payment.expiresAt || current.expiresAt,
              }
            : current,
        );
      }
      if (["shopify_created", "credit_approved"].includes(data.status))
        finishSuccess();
      else if (["failed", "cancelled", "expired"].includes(data.status))
        setMessage(
          "Este checkout não pode mais ser concluído. Recomece pelo carrinho.",
        );
    };
    void check();
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = window.setInterval(check, 2_000);
    window.addEventListener("focus", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials, confirmed, previewMode]);

  const finishSuccess = () => {
    setConfirmed(true);
    sessionStorage.removeItem(ACTIVE_KEY);
    sessionStorage.removeItem("tpp_checkout_launch");
    if (launch?.source === "cart") clearCart();
  };
  const storeActive = (
    active: { sessionId: string; accessToken: string },
    nextSummary: CheckoutSummary,
    nextPayment?: PaymentResult,
  ) =>
    sessionStorage.setItem(
      ACTIVE_KEY,
      JSON.stringify({
        ...active,
        summary: nextSummary,
        payment: nextPayment || null,
      }),
    );
  const validContact = () =>
    customer.name.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) &&
    [11, 14].includes(digits(customer.cpfCnpj).length) &&
    digits(customer.mobilePhone).length >= 10;
  const validAddress = validAddressValue;
  const currentShippingQuoteKey = JSON.stringify({
    items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
    customer: {
      name: customer.name.trim(),
      email: customer.email.trim().toLowerCase(),
      cpfCnpj: digits(customer.cpfCnpj),
      mobilePhone: digits(customer.mobilePhone),
    },
    address,
  });

  useEffect(() => {
    const addressReady = validAddressValue(address);
    const customerReady =
      customer.name.trim().length >= 2 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) &&
      [11, 14].includes(digits(customer.cpfCnpj).length) &&
      digits(customer.mobilePhone).length >= 10;

    if (!addressReady || !customerReady || !items.length) {
      setShippingOptions([]);
      setShippingHandle("");
      setShippingQuoteKey("");
      setShippingAvailabilityLoading(false);
      return;
    }

    if (previewMode) {
      const demo: ShippingOption[] = [
        {
          handle: "preview-local-presidente-prudente",
          code: "LOCAL_DELIVERY",
          title: "Entrega em Presidente Prudente",
          description: "Entrega local para Presidente Prudente/SP",
          amount: 10,
          currencyCode: "BRL",
        },
      ];
      setShippingOptions(demo);
      setShippingHandle(demo[0].handle);
      setShippingQuoteKey(currentShippingQuoteKey);
      setShippingAvailabilityLoading(false);
      return;
    }

    let active = true;
    setShippingAvailabilityLoading(true);
    setShippingOptions([]);
    setShippingHandle("");
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke(
        "checkout-shipping-options",
        { body: { items, customer, address } },
      );
      if (!active) return;
      const options: ShippingOption[] =
        !error && !data?.error && Array.isArray(data?.options)
          ? data.options
          : [];
      setShippingOptions(options);
      setShippingHandle(options[0]?.handle || "");
      setShippingQuoteKey(options.length ? currentShippingQuoteKey : "");
      setShippingAvailabilityLoading(false);
      if (!options.length) setDeliveryMode("pick_up");
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // A chave muda somente quando os dados usados na cotação mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShippingQuoteKey, previewMode]);

  const effectiveBilling =
    deliveryMode === "shipping" && billingSame ? address : billingAddress;
  const markInvalid = (invalidStep: number) =>
    setValidationAttempt({ step: invalidStep, id: Date.now() });

  const openAddressRegistration = () => {
    setAddressDraft({ ...emptyAddress(), postalCode: formatCep(searchedCep) });
    setAddressDraftLabel("");
    setAddressDraftError("");
    setAddressSheetOpen(true);
  };
  const saveCheckoutAddress = async () => {
    if (!addressDraftLabel.trim())
      return setAddressDraftError(
        "Dê um apelido para o endereço, como Casa ou Trabalho.",
      );
    if (!validAddress(addressDraft))
      return setAddressDraftError(
        "Preencha todos os campos obrigatórios do endereço.",
      );
    const saved: SavedAddress = {
      ...addressDraft,
      id: previewMode ? `preview-${Date.now()}` : null,
      label: addressDraftLabel.trim(),
      recipientName: customer.name,
      isDefaultShipping: savedAddresses.length === 0,
      isDefaultBilling: savedAddresses.length === 0,
    };
    setAddressDraftBusy(true);
    setAddressDraftError("");
    if (!previewMode && user) {
      const { data, error } = await supabase.functions.invoke(
        "checkout-customer-data",
        {
          body: {
            action: "save_address",
            label: saved.label,
            recipientName: customer.name,
            address: addressDraft,
            defaultShipping: savedAddresses.length === 0,
            defaultBilling: savedAddresses.length === 0,
          },
        },
      );
      if (error || data?.error) {
        setAddressDraftBusy(false);
        return setAddressDraftError(
          data?.error || "Não foi possível salvar o endereço.",
        );
      }
      saved.id = typeof data?.addressId === "string" ? data.addressId : null;
    }
    setSavedAddresses((current) => [
      ...current.filter((item) => item.id !== saved.id),
      saved,
    ]);
    setAddress(saved);
    setBillingAddress(saved);
    setAddressLabel(saved.label);
    setAddressDraftBusy(false);
    setAddressSheetOpen(false);
    setAddressRegistrationRequired(false);
    setMessage("");
    setResumeAfterAddressSave(true);
    toast.success("Endereço cadastrado", {
      description: user
        ? `${saved.label} ficará disponível nas próximas compras.`
        : "Endereço adicionado a esta compra.",
    });
  };
  const nextDelivery = async () => {
    setMessage("");
    if (!validContact())
      return setMessage(
        user
          ? "Não foi possível carregar todos os dados da sua conta."
          : "Preencha seus dados para continuar.",
      );
    if (digits(searchedCep).length !== 8) {
      markInvalid(0);
      return setMessage("Digite um CEP válido para continuar.");
    }
    if (!validAddress(address)) {
      setValidationAttempt(null);
      setAddressRegistrationRequired(true);
      setMessage(
        "Este CEP ainda não possui um endereço cadastrado. Cadastre-o para continuar ao pagamento.",
      );
      return;
    }
    if (
      (deliveryMode === "pick_up" || !billingSame) &&
      !validAddress(billingAddress)
    ) {
      markInvalid(0);
      return setMessage(
        "Cadastre um endereço de cobrança válido em Minha conta.",
      );
    }
    if (deliveryMode === "shipping") {
      if (shippingAvailabilityLoading)
        return setMessage(
          "Aguarde enquanto verificamos a entrega para este endereço.",
        );
      if (
        shippingQuoteKey !== currentShippingQuoteKey ||
        !shippingOptions.length ||
        !shippingHandle
      ) {
        setDeliveryMode("pick_up");
        return setMessage(
          "Entrega no endereço não está disponível para este CEP. Selecione a retirada gratuita na loja.",
        );
      }
    }
    setValidationAttempt(null);
    setStep(1);
  };
  useEffect(() => {
    if (!resumeAfterAddressSave || !validAddress(address)) return;
    if (
      deliveryMode === "shipping" &&
      (shippingAvailabilityLoading ||
        shippingQuoteKey !== currentShippingQuoteKey)
    )
      return;
    setResumeAfterAddressSave(false);
    void nextDelivery();
    // A continuação acontece uma única vez após o novo endereço entrar no estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address,
    currentShippingQuoteKey,
    deliveryMode,
    resumeAfterAddressSave,
    shippingAvailabilityLoading,
    shippingQuoteKey,
  ]);
  const nextPayment = () => {
    if (isFranchisee) {
      setValidationAttempt(null);
      setMessage("");
      void confirmOrder();
      return;
    }
    if (paymentMethod === "credit_card" && !savedPaymentId) {
      if (!validAddress(effectiveBilling)) {
        markInvalid(1);
        return setMessage(
          "Cadastre um endereço de cobrança válido em Minha conta.",
        );
      }
      if (
        digits(card.number).length < 13 ||
        !card.holderName ||
        !card.expiryMonth ||
        !card.expiryYear ||
        digits(card.ccv).length < 3
      ) {
        markInvalid(1);
        return setMessage("Confira os dados do cartão destacados em vermelho.");
      }
    }
    setValidationAttempt(null);
    setMessage("");
    void confirmOrder();
  };

  async function confirmOrder() {
    if (previewMode)
      return setMessage(
        "Modo de demonstração: nenhuma cobrança ou pedido será criado.",
      );
    setBusy(true);
    setMessage("");
    if (paymentMethod === "credit_card") setCardFailure(null);
    try {
      const selectedShipping = shippingOptions.find(
        (option) => option.handle === shippingHandle,
      );
      const delivery =
        deliveryMode === "pick_up"
          ? { code: "pick_up" }
          : {
              code: "shipping",
              address,
              optionHandle: selectedShipping?.handle,
            };
      const { data: prepared, error: prepareError } =
        await supabase.functions.invoke("checkout-prepare", {
          body: { items, customer, delivery, billingAddress: effectiveBilling },
        });
      if (prepareError || prepared?.error) {
        const detail = prepared?.error || await edgeFunctionErrorText(prepareError, "Falha ao preparar pedido.");
        throw new Error(detail);
      }
      const active = {
        sessionId: prepared.sessionId,
        accessToken: prepared.accessToken,
      };
      setCredentials(active);
      setSummary(prepared.summary);
      storeActive(active, prepared.summary);
      const paymentBody: Record<string, unknown> = {
        ...active,
        method: isFranchisee ? "terms" : paymentMethod,
      };
      if (paymentMethod === "credit_card" && !isFranchisee) {
        paymentBody.installments = selectedInstallments;
        if (savedPaymentId) paymentBody.savedPaymentMethodId = savedPaymentId;
        else {
          paymentBody.card = card;
          paymentBody.saveCard = Boolean(user && saveCard);
        }
      }
      const { data: paymentData, error: paymentError } =
        await supabase.functions.invoke("checkout-payment", {
          body: paymentBody,
        });
      if (paymentError || paymentData?.error) {
        const detail = paymentData?.error || await edgeFunctionErrorText(paymentError, "Falha ao criar cobrança.");
        throw new Error(detail);
      }
      setPayment(paymentData);
      storeActive(active, prepared.summary, paymentData);
      setStep(4);
      if (paymentData.status === "credit_approved") finishSuccess();
    } catch (error) {
      const detail = errorText(error, "Não foi possível concluir o checkout.");
      setMessage(detail);
      if (paymentMethod === "credit_card") setCardFailure(detail);
    } finally {
      setBusy(false);
    }
  }

  const cancelPix = async (destination: "payment" | "cart" = "payment") => {
    if (!credentials || cancellingPix) return;
    setCancellingPix(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("checkout-payment", {
        body: { ...credentials, action: "cancel_pix" },
      });
      if (error || data?.error) {
        const detail = data?.error || await edgeFunctionErrorText(error, "Não foi possível cancelar o Pix.");
        throw new Error(detail);
      }
      if (data?.cancelled !== true) {
        throw new Error("O pagamento já mudou de status e não pode ser cancelado.");
      }
      sessionStorage.removeItem(ACTIVE_KEY);
      setCredentials(null);
      setPayment(null);
      if (destination === "cart") {
        navigate("/carrinho");
      } else {
        setStep(1);
        setMessage("Pix cancelado. Escolha a forma de pagamento para continuar.");
      }
    } catch (error) {
      setMessage(errorText(error, "Não foi possível cancelar o Pix."));
    } finally {
      setCancellingPix(false);
    }
  };

  const changeBagQuantity = async (variantId: string, quantity: number) => {
    if (previewMode) {
      setSummary((current) => {
        if (!current) return current;
        const nextItems = current.items.map((item) =>
          item.variantId === variantId
            ? { ...item, quantity, lineTotal: item.unitPrice * quantity }
            : item,
        );
        const subtotal = nextItems.reduce(
          (total, item) => total + item.lineTotal,
          0,
        );
        return {
          ...current,
          items: nextItems,
          subtotal,
          total: Math.max(
            0,
            subtotal - current.discount + (current.shippingAmount || 0) + (current.serviceFee || SERVICE_FEE),
          ),
        };
      });
      return;
    }
    await updateQuantity(variantId, quantity);
  };
  const removeBagItem = async (variantId: string) => {
    if (previewMode) {
      setSummary((current) => {
        if (!current) return current;
        const nextItems = current.items.filter(
          (item) => item.variantId !== variantId,
        );
        const subtotal = nextItems.reduce(
          (total, item) => total + item.lineTotal,
          0,
        );
        return {
          ...current,
          items: nextItems,
          subtotal,
          total: Math.max(
            0,
            subtotal - current.discount + (current.shippingAmount || 0) + (current.serviceFee || SERVICE_FEE),
          ),
        };
      });
      return;
    }
    await removeItem(variantId);
  };
  const addRecommended = async (product: ShopifyProduct) => {
    const variant = product.node.variants.edges.find(
      ({ node }) => node.availableForSale,
    )?.node;
    if (!variant) return;
    if (previewMode) {
      setSummary((current) => {
        if (!current) return current;
        const existing = current.items.find(
          (item) => item.variantId === variant.id,
        );
        const price = Number(variant.price.amount);
        const nextItems = existing
          ? current.items.map((item) =>
              item.variantId === variant.id
                ? {
                    ...item,
                    quantity: item.quantity + 1,
                    lineTotal: item.lineTotal + price,
                  }
                : item,
            )
          : [
              ...current.items,
              {
                variantId: variant.id,
                productTitle: product.node.title,
                variantTitle: variant.title,
                imageUrl: product.node.images.edges[0]?.node.url,
                quantity: 1,
                unitPrice: price,
                lineTotal: price,
              },
            ];
        const subtotal = nextItems.reduce(
          (total, item) => total + item.lineTotal,
          0,
        );
        return {
          ...current,
          items: nextItems,
          subtotal,
          total: Math.max(
            0,
            subtotal - current.discount + (current.shippingAmount || 0) + (current.serviceFee || SERVICE_FEE),
          ),
        };
      });
    } else {
      await addItem({
        product,
        variantId: variant.id,
        variantTitle: variant.title,
        price: variant.price,
        quantity: 1,
        selectedOptions: variant.selectedOptions || [],
      });
    }
    toast.success("Produto adicionado à sacola", {
      description: product.node.title,
      position: "top-center",
    });
  };

  if (!customCheckoutEnabled && !previewMode)
    return (
      <Centered
        title="Checkout em homologação"
        text="Continue pelo checkout seguro atualmente disponível."
      />
    );
  if (!previewMode && authLoading)
    return (
      <Centered
        title="Abrindo checkout"
        text="Carregando os dados da sua conta..."
      />
    );
  if (!previewMode && !user) return <AccountRequiredCheckout />;
  if (!items.length)
    return (
      <Centered
        title="Seu carrinho está vazio"
        text="Escolha os produtos antes de abrir o checkout."
      />
    );
  if (confirmed) return <Success payment={payment} summary={summary} />;

  const selectedShipping = shippingOptions.find(
    (option) => option.handle === shippingHandle,
  );
  const selectedSavedAddress = savedAddresses.find(
    (item) =>
      digits(item.postalCode) === digits(searchedCep) && validAddress(item),
  );
  if (step === 1)
    return (
      <PaymentCheckoutScreen
        summary={summary}
        cartItems={cartItems}
        address={address}
        addressLabel={selectedSavedAddress?.label || addressLabel}
        deliveryMode={deliveryMode}
        selectedShipping={selectedShipping}
        busy={busy}
        processingCard={busy && paymentMethod === "credit_card"}
        cardFailure={cardFailure}
        onDismissCardFailure={() => setCardFailure(null)}
        onChoosePixAfterFailure={() => {
          setCardFailure(null);
          setMessage("");
          setSavedPaymentId("");
          setPaymentMethod("pix");
        }}
        message={message}
        submitLabel={
          isFranchisee
            ? "Finalizar pedido"
            : paymentMethod === "pix"
              ? "Gerar Pix e finalizar"
              : "Pagar com cartão"
        }
        onBack={() => {
          setMessage("");
          setStep(0);
        }}
        onNext={nextPayment}
      >
        <PaymentStep
          franchise={isFranchisee}
          deliveryMode={deliveryMode}
          method={paymentMethod}
          setMethod={setPaymentMethod}
          shippingOptions={shippingOptions}
          shippingHandle={shippingHandle}
          setShippingHandle={setShippingHandle}
          saved={savedPayments}
          savedId={savedPaymentId}
          setSavedId={setSavedPaymentId}
          plans={cardPlans}
          installments={selectedInstallments}
          setInstallments={setInstallments}
          card={card}
          setCard={setCard}
          saveCard={saveCard}
          setSaveCard={setSaveCard}
          loggedIn={Boolean(user)}
          onBack={() => setStep(0)}
          onNext={nextPayment}
        />
      </PaymentCheckoutScreen>
    );
  return (
    <main
      ref={pageRef}
      className="min-h-screen overflow-x-hidden bg-white pb-24"
    >
      <div className="mx-auto max-w-[1240px]">
        <CheckoutHeader />
        <div className="px-4 pt-5 sm:px-6 sm:pt-7 lg:px-0 lg:pt-8">
          <h1
            data-checkout-enter
            className="mb-5 text-2xl font-bold tracking-tight text-slate-900"
          >
            Sacola
          </h1>
          {step > 0 && (
            <div data-checkout-enter className="lg:hidden">
              <Steps current={Math.min(step, 1)} />
            </div>
          )}
          <div data-checkout-enter className="mb-4 lg:hidden">
            <MobileOrderSummary
              summary={summary}
              cartItems={cartItems}
              showServiceFee={step !== 0}
              shippingOverride={
                step === 0 && deliveryMode === "pick_up"
                  ? { title: "Retirada na loja", amount: 0 }
                  : step === 0 && selectedShipping
                    ? {
                        title: selectedShipping.title,
                        amount: selectedShipping.amount,
                      }
                  : undefined
              }
            />
            {step === 0 && (
              <DeliveryCheckoutAction
                message={message}
                registrationRequired={addressRegistrationRequired}
                busy={busy || customerDataLoading}
                onRegister={openAddressRegistration}
                onContinue={nextDelivery}
              />
            )}
          </div>
          <div
            data-checkout-enter
            className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-10"
          >
            <div className="min-w-0">
              {step < 4 && (
                <CheckoutBag
                  summary={summary}
                  cartItems={cartItems}
                  editable={previewMode || !launch || launch.source === "cart"}
                  busy={cartBusy}
                  onQuantity={changeBagQuantity}
                  onRemove={removeBagItem}
                />
              )}
              {step > 0 && (
                <Card className="overflow-hidden rounded-xl border border-slate-200 shadow-none">
                  <CardHeader className="border-b border-slate-100 px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-blue-700">
                      {step < 2 ? `Etapa ${step + 1} de 2` : "Pagamento"}
                    </p>
                    <CardTitle className="text-xl tracking-tight text-slate-900 sm:text-2xl">
                      {
                        [
                          "",
                          "Pagamento",
                          "",
                          "",
                          payment?.pixQrCode
                            ? "Pague com Pix"
                            : "Processando pagamento",
                        ][step]
                      }
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6 [&_input]:h-12 [&_input]:rounded-lg [&_input]:border-slate-300 [&_input]:bg-white [&_input]:text-base [&_input]:transition-colors [&_input:focus]:border-blue-700">
                    <div ref={stepContentRef} className="checkout-step">
                      {message && !validationAttempt && (
                        <Alert
                          role="alert"
                          aria-live="assertive"
                          variant="destructive"
                          className="mb-5"
                        >
                          <AlertTitle>Atenção</AlertTitle>
                          <AlertDescription>
                            <p>{message}</p>
                            {addressRegistrationRequired && (
                              <Button
                                type="button"
                                size="sm"
                                className="mt-3 bg-red-700 text-white hover:bg-red-800"
                                onClick={openAddressRegistration}
                              >
                                Cadastrar endereço
                              </Button>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                      {step === 1 && (
                        <PaymentStep
                          franchise={isFranchisee}
                          deliveryMode={deliveryMode}
                          method={paymentMethod}
                          setMethod={setPaymentMethod}
                          shippingOptions={shippingOptions}
                          shippingHandle={shippingHandle}
                          setShippingHandle={setShippingHandle}
                          saved={savedPayments}
                          savedId={savedPaymentId}
                          setSavedId={setSavedPaymentId}
                          plans={cardPlans}
                          installments={selectedInstallments}
                          setInstallments={setInstallments}
                          card={card}
                          setCard={setCard}
                          saveCard={saveCard}
                          setSaveCard={setSaveCard}
                          loggedIn={Boolean(user)}
                          onBack={() => setStep(0)}
                          onNext={nextPayment}
                        />
                      )}
                      {step === 4 && (
                        <PaymentWaiting
                          payment={payment}
                          pickup={deliveryMode === "pick_up"}
                          cancelling={cancellingPix}
                          onCancel={() => void cancelPix("payment")}
                          onBack={() => void cancelPix("cart")}
                        />
                      )}
                      {validationAttempt?.step === step && message && (
                        <InlineFormError message={message} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
              {step < 4 && (
                <RecommendedProducts
                  products={recommended}
                  loading={recommendedLoading}
                  busy={cartBusy}
                  onAdd={addRecommended}
                />
              )}
            </div>
            <aside className="order-first h-fit space-y-7 lg:sticky lg:top-6 lg:order-none">
              {step === 0 && (
                <DeliverySidebar
                  searchedCep={searchedCep}
                  setSearchedCep={setSearchedCep}
                  address={address}
                  mode={deliveryMode}
                  setMode={setDeliveryMode}
                  addressLabel={selectedSavedAddress?.label || addressLabel}
                  isSaved={Boolean(selectedSavedAddress)}
                  loggedIn
                  shippingAvailable={shippingOptions.length > 0}
                  shippingLoading={shippingAvailabilityLoading}
                />
              )}
              <div className="hidden lg:block">
                <OrderSummary
                  summary={summary}
                  cartItems={cartItems}
                  showServiceFee={step !== 0}
                  shippingOverride={
                    step === 0 && deliveryMode === "pick_up"
                      ? { title: "Retirada na loja", amount: 0 }
                      : step === 0 && selectedShipping
                        ? {
                            title: selectedShipping.title,
                            amount: selectedShipping.amount,
                          }
                      : undefined
                  }
                />
                {step === 0 && (
                  <DeliveryCheckoutAction
                    message={message}
                    registrationRequired={addressRegistrationRequired}
                    busy={busy || customerDataLoading}
                    onRegister={openAddressRegistration}
                    onContinue={nextDelivery}
                  />
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
      <AddressRegistrationSheet
        open={addressSheetOpen}
        setOpen={setAddressSheetOpen}
        value={addressDraft}
        setValue={setAddressDraft}
        label={addressDraftLabel}
        setLabel={setAddressDraftLabel}
        error={addressDraftError}
        busy={addressDraftBusy}
        onSave={saveCheckoutAddress}
      />
    </main>
  );
}

function Steps({ current }: { current: number }) {
  const labels = ["Entrega", "Pagamento"];
  return (
    <ol
      aria-label="Etapas do checkout"
      className="relative mb-5 grid grid-cols-2 sm:mb-7"
    >
      <span
        aria-hidden
        className="absolute left-1/4 right-1/4 top-3.5 h-px bg-slate-200"
      />
      <span
        aria-hidden
        className="absolute left-1/4 top-3.5 h-px bg-blue-800 transition-[width] duration-500"
        style={{ width: `${current * 50}%` }}
      />
      {labels.map((label, index) => (
        <li
          key={label}
          className="relative z-10 flex min-w-0 flex-col items-center gap-1.5 text-center"
        >
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors duration-300 ${index < current ? "bg-emerald-600 text-white" : index === current ? "bg-blue-900 text-white" : "border border-slate-200 bg-white text-slate-400"}`}
          >
            {index < current ? <Check className="h-3.5 w-3.5" /> : index + 1}
          </span>
          <span
            className={`max-w-full truncate px-0.5 text-[10px] font-medium sm:text-xs ${index === current ? "text-blue-950" : index < current ? "text-emerald-700" : "text-slate-400"}`}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-step-item className="min-w-0 space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      {children}
    </div>
  );
}
function Choice({
  active,
  onClick,
  icon,
  title,
  text,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      data-step-item
      type="button"
      onClick={onClick}
      className={`flex min-h-[72px] w-full touch-manipulation items-center gap-3 rounded-lg border px-4 py-3 text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.99] ${active ? "border-blue-800 bg-blue-50/50" : "border-slate-200 bg-white hover:border-slate-400"}`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md [&>svg]:h-5 [&>svg]:w-5 ${active ? "text-blue-900" : "text-slate-700"}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-sm leading-tight text-slate-900">
          {title}
        </strong>
        <small className="mt-1 block leading-snug text-slate-500">{text}</small>
      </span>
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${active ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white"}`}
      >
        {active && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
    </button>
  );
}
function AddressCard({
  address,
  selected,
  onClick,
}: {
  address: SavedAddress;
  selected?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-900" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase text-slate-900">
              {address.label || "Endereço"}
            </p>
            {address.isDefaultShipping && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                Padrão
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-700">
            {address.address1}, {address.number}
            {address.address2 ? `, ${address.address2}` : ""}
          </p>
          <p className="text-sm text-slate-600">
            {address.neighborhood} - {address.city}/{address.provinceCode}
          </p>
          <p className="text-sm text-slate-600">CEP: {address.postalCode}</p>
        </div>
        {selected && (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
        )}
      </div>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${selected ? "border-blue-800 bg-blue-50/40" : "border-slate-200 bg-white hover:border-slate-400"}`}
    >
      {content}
    </button>
  ) : (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {content}
    </div>
  );
}
function DeliverySidebar({
  searchedCep,
  setSearchedCep,
  address,
  mode,
  setMode,
  addressLabel,
  isSaved,
  loggedIn,
  shippingAvailable,
  shippingLoading,
}: {
  searchedCep: string;
  setSearchedCep: (value: string) => void;
  address: Address;
  mode: "pick_up" | "shipping";
  setMode: (value: "pick_up" | "shipping") => void;
  addressLabel: string;
  isSaved: boolean;
  loggedIn: boolean;
  shippingAvailable: boolean;
  shippingLoading: boolean;
}) {
  const completeAddress = validAddressValue(address);
  const hasCep = digits(searchedCep).length === 8;
  const displayAddress: SavedAddress = {
    ...address,
    id: null,
    label: addressLabel,
    recipientName: "",
    isDefaultShipping: true,
    isDefaultBilling: true,
  };
  return (
    <section aria-labelledby="delivery-sidebar-title">
      <div className="mb-2.5 flex items-center justify-between">
        <h2
          id="delivery-sidebar-title"
          className="text-sm font-bold text-slate-900"
        >
          Qual o CEP?
        </h2>
        {searchedCep && (
          <button
            type="button"
            onClick={() => setSearchedCep("")}
            className="text-xs font-semibold text-blue-800 hover:underline"
          >
            Alterar
          </button>
        )}
      </div>
      <div className="relative">
        <Input
          value={searchedCep}
          onChange={(event) => setSearchedCep(formatCep(event.target.value))}
          placeholder="00000-000"
          inputMode="numeric"
          maxLength={9}
          autoComplete="postal-code"
          className="h-12 pr-11 text-base"
        />
        {completeAddress && isSaved && (
          <CheckCircle2 className="absolute right-3 top-3.5 h-5 w-5 text-emerald-600" />
        )}
      </div>
      {hasCep && !isSaved && (
        <p className="mt-2 text-xs text-slate-500">
          CEP informado. O endereço será solicitado somente ao continuar para o
          pagamento.
        </p>
      )}
      {!hasCep && (
        <p className="mt-2 text-xs text-slate-500">
          Digite o CEP para mostrar as formas de entrega.
        </p>
      )}
      {hasCep && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="mt-6">
            <p className="mb-2.5 text-sm font-bold text-slate-900">
              Escolha a forma de entrega
            </p>
            <div className="space-y-2.5">
              {shippingLoading && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verificando entrega para este endereço...
                </div>
              )}
              {shippingAvailable && !shippingLoading && (
                <Choice
                  active={mode === "shipping"}
                  onClick={() => setMode("shipping")}
                  icon={<PackageCheck />}
                  title="Entrega no endereço"
                  text="Frete calculado para o endereço informado"
                />
              )}
              <Choice
                active={mode === "pick_up"}
                onClick={() => setMode("pick_up")}
                icon={<Store />}
                title="Retirada na loja"
                text="Sem custo de entrega"
              />
              {!shippingAvailable &&
                !shippingLoading &&
                completeAddress &&
                isSaved && (
                <p className="px-1 text-xs text-slate-500">
                  Entrega no endereço indisponível para este CEP.
                </p>
              )}
            </div>
          </div>
          {mode === "shipping" &&
            shippingAvailable &&
            completeAddress &&
            isSaved && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-bold text-slate-900">
                Endereço de entrega
              </p>
              <AddressCard address={displayAddress} />
            </div>
          )}
        </div>
      )}
      {!loggedIn && hasCep && (
        <p className="mt-4 text-xs text-amber-700">
          Entre na conta antes de seguir ao pagamento.
        </p>
      )}
    </section>
  );
}
function DeliveryCheckoutAction({
  message,
  registrationRequired,
  busy,
  onRegister,
  onContinue,
}: {
  message: string;
  registrationRequired: boolean;
  busy: boolean;
  onRegister: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="mt-4">
      {message && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <p>{message}</p>
          {registrationRequired && (
            <Button
              type="button"
              size="sm"
              className="mt-3 bg-red-700 text-white hover:bg-red-800"
              onClick={onRegister}
            >
              Cadastrar endereço
            </Button>
          )}
        </div>
      )}
      <Button
        type="button"
        size="lg"
        className="h-12 w-full bg-blue-900 hover:bg-blue-800"
        disabled={busy}
        onClick={onContinue}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {busy ? "Carregando..." : "Ir para pagamento"}
      </Button>
    </div>
  );
}
function CheckoutHeader({ onBack }: { onBack?: () => void }) {
  return (
    <>
      <header
        data-checkout-enter
        className="flex h-16 items-center justify-between border-b border-slate-200 px-4 sm:h-20 sm:px-6 lg:px-0"
      >
        <Link to="/" aria-label="Voltar para a TudoPraPet">
          <img src={logo} alt="TudoPraPet" className="w-32 sm:w-44" />
        </Link>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 sm:gap-3 sm:text-sm">
          {onBack && (
            <>
              <button type="button" onClick={onBack} className="flex items-center gap-1 hover:underline">
                <ChevronDown className="h-4 w-4 rotate-90" />
                <span className="hidden sm:inline">Voltar para a sacola</span>
                <span className="sm:hidden">Voltar</span>
              </button>
              <span className="hidden h-5 w-px bg-slate-300 sm:block" />
            </>
          )}
          <span className="flex items-center gap-1.5">
            <LockKeyhole className="h-4 w-4" />
            <span className="hidden sm:inline">Ambiente seguro</span>
          </span>
        </div>
      </header>
      <div
        data-checkout-enter
        className="flex min-h-10 items-center justify-center gap-2 border-b border-slate-100 bg-[#faf8f5] px-4 py-2 text-center text-xs text-slate-700 sm:text-sm"
      >
        <PackageCheck className="h-4 w-4 shrink-0 text-blue-800" />
        <strong>Entrega calculada pelo seu CEP</strong>
        <span className="hidden text-slate-400 sm:inline">•</span>
        <span className="hidden sm:inline">retirada na loja também disponível</span>
      </div>
    </>
  );
}
function PaymentCheckoutScreen({
  summary,
  cartItems,
  address,
  addressLabel,
  deliveryMode,
  selectedShipping,
  busy,
  processingCard,
  cardFailure,
  onDismissCardFailure,
  onChoosePixAfterFailure,
  message,
  submitLabel,
  onBack,
  onNext,
  children,
}: {
  summary: CheckoutSummary | null;
  cartItems: CartItem[];
  address: Address;
  addressLabel: string;
  deliveryMode: "pick_up" | "shipping";
  selectedShipping?: ShippingOption;
  busy: boolean;
  processingCard: boolean;
  cardFailure: string | null;
  onDismissCardFailure: () => void;
  onChoosePixAfterFailure: () => void;
  message: string;
  submitLabel: string;
  onBack: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  const savedAddress: SavedAddress = {
    ...address,
    id: null,
    label: addressLabel,
    recipientName: "",
    isDefaultShipping: true,
    isDefaultBilling: true,
  };
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-[1240px]">
        <CheckoutHeader onBack={onBack} />
      </div>
      <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-0">
        <h1 className="mb-5 text-2xl font-bold text-slate-950">Pagamento</h1>
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-10">
          <div className="space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <h2 className="mb-1 font-bold text-slate-900">
                Formas de pagamento
              </h2>
              <p className="mb-5 text-sm text-slate-500">
                Escolha como deseja pagar seu pedido.
              </p>
              <div className="[&>div>div[data-step-item]:last-child]:hidden">
                {children}
              </div>
              {message && <InlineFormError message={message} />}
            </section>
            <CheckoutBag
              summary={summary}
              cartItems={cartItems}
              editable={false}
              busy={false}
              onQuantity={() => undefined}
              onRemove={() => undefined}
            />
          </div>
          <aside className="space-y-4 lg:sticky lg:top-6">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex gap-3">
                <PackageCheck className="h-5 w-5 shrink-0 text-blue-900" />
                <div>
                  <p className="text-xs text-slate-500">Prazo de entrega</p>
                  <p className="text-sm font-bold text-slate-900">
                    {deliveryMode === "pick_up"
                      ? "Retirada na loja"
                      : selectedShipping?.description ||
                        selectedShipping?.title ||
                        "Calculado para seu endereço"}
                  </p>
                </div>
              </div>
            </div>
            {deliveryMode === "shipping" && validAddressValue(address) && (
              <AddressCard address={savedAddress} />
            )}
            {deliveryMode === "pick_up" && (
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-bold uppercase text-slate-900">
                  Retirada na loja
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  O local será confirmado no pedido.
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={onBack}
              className="w-full text-center text-xs font-semibold text-blue-800 hover:underline"
            >
              Alterar forma de entrega ou endereço
            </button>
            <div className="rounded-xl border border-slate-200 p-5">
              <OrderSummary
                summary={summary}
                cartItems={cartItems}
                shippingOverride={
                  deliveryMode === "pick_up"
                    ? { title: "Retirada na loja", amount: 0 }
                    : selectedShipping
                      ? { title: selectedShipping.title, amount: selectedShipping.amount }
                      : undefined
                }
              />
            </div>
            <Button
              type="button"
              size="lg"
              className="h-12 w-full bg-blue-700 hover:bg-blue-800"
              disabled={busy}
              onClick={onNext}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy ? "Processando..." : submitLabel}
            </Button>
          </aside>
        </div>
      </div>
      <footer className="mt-10 border-t border-slate-200 bg-slate-50 py-5 text-center text-xs text-slate-500">
        © 2026 TudoPraPet. Todos os direitos reservados.
      </footer>
      {processingCard && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="card-processing-title"
            aria-describedby="card-processing-description"
            className="w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-2xl"
          >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
              <Loader2 className="h-8 w-8 animate-spin text-blue-800" aria-hidden="true" />
            </div>
            <h2 id="card-processing-title" className="text-xl font-bold text-slate-950">
              Processando seu pagamento
            </h2>
            <p id="card-processing-description" className="mt-2 text-sm leading-relaxed text-slate-600">
              Estamos validando os dados com segurança junto ao emissor do cartão. Isso pode levar alguns segundos.
            </p>
            <p className="mt-4 text-xs font-medium text-slate-500">
              Não feche nem atualize esta página.
            </p>
          </div>
        </div>
      )}
      {!processingCard && cardFailure && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="card-failure-title"
            aria-describedby="card-failure-description"
            className="w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-2xl"
          >
            <XCircle className="mx-auto h-16 w-16 text-red-600" aria-hidden="true" />
            <h2 id="card-failure-title" className="mt-4 text-xl font-bold text-slate-950">
              Pagamento não aprovado
            </h2>
            <p id="card-failure-description" className="mt-2 text-sm leading-relaxed text-slate-600">
              {cardFailure}
            </p>
            <div className="mt-6 grid gap-2">
              <Button type="button" className="h-11 bg-blue-900 hover:bg-blue-800" onClick={onDismissCardFailure}>
                Conferir cartão e tentar novamente
              </Button>
              <Button type="button" variant="outline" className="h-11" onClick={onChoosePixAfterFailure}>
                Escolher Pix
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
function AddressRegistrationSheet({
  open,
  setOpen,
  value,
  setValue,
  label,
  setLabel,
  error,
  busy,
  onSave,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  value: Address;
  setValue: (value: Address) => void;
  label: string;
  setLabel: (label: string) => void;
  error: string;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] w-[calc(100%_-_2rem)] overflow-y-auto p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-slate-200 px-5 pb-5 pt-6 pr-14 text-left sm:px-6">
          <DialogTitle className="text-xl text-slate-950">
            Cadastrar novo endereço
          </DialogTitle>
          <DialogDescription>
            Este CEP ainda não está nos seus endereços. Complete os dados para
            continuar ao pagamento.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-1 sm:px-6">
          <Field label="Apelido do endereço">
            <Input
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value.slice(0, 40))}
              placeholder="Ex.: Casa, Trabalho, Mãe"
              maxLength={40}
            />
            <p className="text-xs text-slate-500">
              Esse nome aparecerá nas próximas compras.
            </p>
          </Field>
          <Field label="CEP">
            <Input readOnly value={value.postalCode} className="bg-slate-50" />
          </Field>
          <Field label="Rua ou avenida">
            <Input
              value={value.address1}
              onChange={(event) =>
                setValue({ ...value, address1: event.target.value })
              }
              autoComplete="address-line1"
              placeholder="Rua ou avenida"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Número">
              <Input
                value={value.number}
                onChange={(event) =>
                  setValue({ ...value, number: event.target.value })
                }
                placeholder="Número"
              />
            </Field>
            <Field label="Complemento">
              <Input
                value={value.address2}
                onChange={(event) =>
                  setValue({ ...value, address2: event.target.value })
                }
                autoComplete="address-line2"
                placeholder="Apto, bloco... (opcional)"
              />
            </Field>
          </div>
          <Field label="Bairro">
            <Input
              value={value.neighborhood}
              onChange={(event) =>
                setValue({ ...value, neighborhood: event.target.value })
              }
              placeholder="Bairro"
            />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-4">
            <Field label="Cidade">
              <Input
                value={value.city}
                onChange={(event) =>
                  setValue({ ...value, city: event.target.value })
                }
                autoComplete="address-level2"
                placeholder="Cidade"
              />
            </Field>
            <Field label="UF">
              <Input
                value={value.provinceCode}
                onChange={(event) =>
                  setValue({
                    ...value,
                    provinceCode: event.target.value.toUpperCase().slice(0, 2),
                  })
                }
                autoComplete="address-level1"
                placeholder="SP"
                maxLength={2}
              />
            </Field>
          </div>
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button type="button" disabled={busy} onClick={onSave}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar e
            continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function PaymentStep(props: {
  franchise: boolean;
  deliveryMode: "pick_up" | "shipping";
  method: "pix" | "credit_card";
  setMethod: (v: "pix" | "credit_card") => void;
  shippingOptions: ShippingOption[];
  shippingHandle: string;
  setShippingHandle: (v: string) => void;
  saved: SavedPayment[];
  savedId: string;
  setSavedId: (v: string) => void;
  plans: InstallmentPlan[];
  installments: number;
  setInstallments: (v: number) => void;
  card: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  setCard: (v: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  }) => void;
  saveCard: boolean;
  setSaveCard: (v: boolean) => void;
  loggedIn: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  if (props.franchise)
    return (
      <div className="space-y-5">
        <Choice
          active
          onClick={() => {}}
          icon={<CreditCard className="h-5 w-5" />}
          title="Prazo da franquia"
          text="Cobrança com vencimento conforme sua condição comercial"
        />
        <Nav
          back={props.onBack}
          next={props.onNext}
          nextLabel="Finalizar pedido"
        />
      </div>
    );
  return (
    <div className="space-y-5">
      {props.deliveryMode === "shipping" &&
        props.shippingOptions.length > 0 && (
          <div>
            <p className="mb-2 font-semibold">Modalidade de entrega</p>
            <div className="space-y-2">
              {props.shippingOptions.map((option) => (
                <Choice
                  key={option.handle}
                  active={props.shippingHandle === option.handle}
                  onClick={() => props.setShippingHandle(option.handle)}
                  icon={<MapPin className="h-5 w-5" />}
                  title={`${option.title} — ${money(option.amount)}`}
                  text={
                    option.description ||
                    "Tarifa calculada para o endereço informado"
                  }
                />
              ))}
            </div>
          </div>
        )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          active={props.method === "pix"}
          onClick={() => props.setMethod("pix")}
          icon={<PackageCheck className="h-5 w-5" />}
          title="Pix"
          text="Confirmação automática"
        />
        <Choice
          active={props.method === "credit_card"}
          onClick={() => props.setMethod("credit_card")}
          icon={<CreditCard className="h-5 w-5" />}
          title="Cartão"
          text="Processado com segurança pelo Asaas"
        />
      </div>
      {props.method === "credit_card" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="card-installments" className="text-sm font-bold text-slate-900">
              Parcelas
            </label>
            <select
              id="card-installments"
              value={String(props.installments)}
              onChange={(event) => props.setInstallments(Number(event.target.value))}
              className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
            >
              {props.plans.map((plan) => (
                <option key={plan.installments} value={String(plan.installments)}>
                  {installmentLabel(plan, money)}
                </option>
              ))}
            </select>
            {(() => {
              const plan = props.plans.find(
                (item) => item.installments === props.installments,
              );
              if (!plan) return null;
              if (plan.installments === 1)
                return (
                  <p className="text-xs text-slate-500">
                    Total no cartão à vista: {money(plan.chargedTotal)}.
                  </p>
                );
              return (
                <p className="text-xs text-slate-500">
                  Juros do parcelamento: {money(plan.chargedTotal - props.plans[0].chargedTotal)} —
                  à vista sai por {money(props.plans[0].chargedTotal)}.
                </p>
              );
            })()}
          </div>
          {props.saved.map((item) => (
            <Choice
              key={item.id}
              active={props.savedId === item.id}
              onClick={() => props.setSavedId(item.id)}
              icon={<CreditCard className="h-5 w-5" />}
              title={`${item.brand || "Cartão"} final ${item.lastFour}`}
              text={item.holderName || "Cartão salvo"}
            />
          ))}
          {props.saved.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => props.setSavedId("")}
            >
              Usar outro cartão
            </Button>
          )}
          {!props.savedId && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome no cartão">
                  <Input
                    value={props.card.holderName}
                    onChange={(e) =>
                      props.setCard({
                        ...props.card,
                        holderName: e.target.value,
                      })
                    }
                    autoComplete="cc-name"
                  />
                </Field>
                <Field label="Número do cartão">
                  <Input
                    value={props.card.number}
                    onChange={(e) =>
                      props.setCard({ ...props.card, number: e.target.value })
                    }
                    inputMode="numeric"
                    autoComplete="cc-number"
                  />
                </Field>
                <Field label="Mês">
                  <Input
                    maxLength={2}
                    value={props.card.expiryMonth}
                    onChange={(e) =>
                      props.setCard({
                        ...props.card,
                        expiryMonth: e.target.value,
                      })
                    }
                    inputMode="numeric"
                    autoComplete="cc-exp-month"
                  />
                </Field>
                <Field label="Ano">
                  <Input
                    maxLength={4}
                    value={props.card.expiryYear}
                    onChange={(e) =>
                      props.setCard({
                        ...props.card,
                        expiryYear: e.target.value.replace(/\D/g, "").slice(0, 4),
                      })
                    }
                    inputMode="numeric"
                    autoComplete="cc-exp-year"
                    placeholder="AAAA ou AA"
                  />
                </Field>
                <Field label="CVV">
                  <Input
                    type="password"
                    maxLength={4}
                    value={props.card.ccv}
                    onChange={(e) =>
                      props.setCard({ ...props.card, ccv: e.target.value })
                    }
                    inputMode="numeric"
                    autoComplete="cc-csc"
                  />
                </Field>
              </div>
              {props.loggedIn && (
                <CheckLine
                  checked={props.saveCard}
                  onChange={props.setSaveCard}
                  label="Salvar cartão"
                />
              )}
              <p className="text-xs text-slate-500">
                A TudoPraPet não armazena o número completo nem o CVV.
              </p>
            </>
          )}
        </div>
      )}
      <Nav
        back={props.onBack}
        next={props.onNext}
        nextLabel={
          props.method === "pix" ? "Gerar Pix e finalizar" : "Pagar com cartão"
        }
      />
    </div>
  );
}
function Nav({
  busy,
  back,
  next,
  nextLabel,
}: {
  busy?: boolean;
  back: () => void;
  next: () => void;
  nextLabel: string;
}) {
  return (
    <div
      data-step-item
      className="sticky bottom-0 z-20 -mx-4 flex gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:static sm:mx-0 sm:gap-3 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-2 sm:shadow-none"
    >
      <Button
        type="button"
        className="h-12 rounded-xl px-3 sm:px-4"
        variant="ghost"
        onClick={back}
        disabled={busy}
      >
        Voltar
      </Button>
      <Button
        type="button"
        className="h-12 min-w-0 flex-1 rounded-xl bg-blue-900 px-3 hover:bg-blue-800 sm:px-4"
        size="lg"
        onClick={next}
        disabled={busy}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />}
        <span className="truncate">{nextLabel}</span>
      </Button>
    </div>
  );
}
function InlineFormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      aria-live="polite"
      className="mt-4 flex items-start gap-2 text-sm font-medium text-red-600"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
function CheckLine({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      data-step-item
      className="flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-800"
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-slate-300 bg-white text-white transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 peer-checked:border-blue-900 peer-checked:bg-blue-900"
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <span className="leading-snug">{label}</span>
    </label>
  );
}
function PaymentWaiting({
  payment,
  pickup,
  cancelling,
  onCancel,
  onBack,
}: {
  payment: PaymentResult | null;
  pickup: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onBack: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const expiresAt = payment?.expiresAt ? Date.parse(payment.expiresAt) : NaN;
  const hasExpiration = Number.isFinite(expiresAt);
  const remainingSeconds = hasExpiration
    ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
    : null;
  const expired = remainingSeconds === 0;

  useEffect(() => {
    if (!hasExpiration || expired) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasExpiration, expired]);

  if (payment && ["confirmed", "received"].includes(payment.status)) {
    return (
      <div className="py-10 text-center sm:py-12" aria-live="polite">
        <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-emerald-600" />
        <h2 className="text-xl font-bold text-slate-950">Pagamento confirmado</h2>
        <p className="mx-auto mt-2 max-w-md text-slate-600">
          Recebemos seu pagamento e seu pedido entrou na fila de preparação.
        </p>
        {pickup && (
          <div className="mx-auto mt-5 max-w-md rounded-xl border border-amber-300 bg-amber-50 p-4 text-left">
            <p className="font-bold text-amber-950">Não vá até a loja ainda</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900">
              Aguarde nosso aviso informando que o pedido está pronto. A retirada
              somente será liberada depois dessa confirmação.
            </p>
            {PICKUP_STORE_ADDRESS && PICKUP_STORE_HOURS && (
              <div className="mt-3 border-t border-amber-200 pt-3 text-sm text-amber-950">
                <p><strong>Local:</strong> {PICKUP_STORE_ADDRESS}</p>
                <p className="mt-1"><strong>Funcionamento:</strong> {PICKUP_STORE_HOURS}</p>
              </div>
            )}
          </div>
        )}
        <Wait
          label={pickup ? "Registrando seu pedido" : "Preparando confirmação"}
        />
      </div>
    );
  }

  if (payment?.pixQrCode && expired)
    return (
      <div className="py-10 text-center sm:py-12">
        <AlertCircle className="mx-auto mb-4 h-14 w-14 text-red-700" />
        <h2 className="text-xl font-bold">Pix expirado</h2>
        <p className="mx-auto mt-2 max-w-md text-slate-600">
          O prazo de 15 minutos terminou. A cobrança será cancelada com
          segurança e não pode mais ser reutilizada.
        </p>
        <Button type="button" variant="outline" className="mt-6" disabled={cancelling} onClick={onBack}>
          {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {cancelling ? "Cancelando Pix..." : "Voltar à sacola"}
        </Button>
      </div>
    );

  if (payment?.pixQrCode) {
    const minutes = remainingSeconds === null
      ? null
      : Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds === null ? null : remainingSeconds % 60;
    return (
      <div className="text-center">
        <p className="mb-5 text-slate-600">
          Escaneie o QR Code ou copie o Pix. A confirmação aparece
          automaticamente.
        </p>
        {minutes !== null && seconds !== null && (
          <p className="mb-4 text-sm font-semibold text-blue-900" aria-live="polite">
            Expira em {String(minutes).padStart(2, "0")}:
            {String(seconds).padStart(2, "0")}
          </p>
        )}
        <img
          src={`data:image/png;base64,${payment.pixQrCode}`}
          alt="QR Code Pix"
          className="mx-auto aspect-square h-auto w-full max-w-64 rounded-xl border bg-white p-3"
        />
        <div className="mt-5 flex min-w-0 gap-2">
          <Input
            readOnly
            value={payment.pixCopyPaste || ""}
            className="min-w-0"
          />
          <Button
            className="h-12 shrink-0"
            variant="outline"
            aria-label="Copiar código Pix"
            onClick={() =>
              void navigator.clipboard.writeText(payment.pixCopyPaste || "")
            }
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <Wait />
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button type="button" variant="ghost" disabled={cancelling} onClick={onBack}>
            {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Voltar à sacola
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={cancelling}
            onClick={onCancel}
            className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
          >
            {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {cancelling ? "Cancelando Pix..." : "Cancelar Pix e trocar pagamento"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Ao voltar à sacola, este Pix será cancelado antes de sair da página.
        </p>
      </div>
    );
  }
  return (
    <div className="py-10 text-center sm:py-12">
      <CreditCard className="mx-auto mb-4 h-14 w-14 text-blue-900" />
      <h2 className="text-xl font-bold">Pagamento enviado</h2>
      <p className="mt-2 text-slate-600">
        Aguardando confirmação segura do Asaas.
      </p>
      <Wait />
    </div>
  );
}
function Wait({ label = "Aguardando confirmação" }: { label?: string }) {
  return (
    <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-600">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}
function CheckoutBag({
  summary,
  cartItems,
  editable,
  busy,
  onQuantity,
  onRemove,
}: {
  summary: CheckoutSummary | null;
  cartItems: CartItem[];
  editable: boolean;
  busy: boolean;
  onQuantity: (variantId: string, quantity: number) => void;
  onRemove: (variantId: string) => void;
}) {
  const { getSubscriberPrice } = useSubscriberPrices();
  const { getFranchisePrice } = useFranchisePrices();
  const catalogPrices = new Map(
    cartItems.map((item) => [item.variantId, Number(item.price.amount)]),
  );
  const list =
    summary?.items ??
    cartItems.map((item) => ({
      variantId: item.variantId,
      productTitle: item.product.node.title,
      variantTitle: item.variantTitle,
      imageUrl: item.product.node.images?.edges?.[0]?.node?.url,
      quantity: item.quantity,
      unitPrice: Number(item.price.amount),
      lineTotal: Number(item.price.amount) * item.quantity,
    }));
  // Preço especial (franquia/assinante) para exibir o valor original cortado.
  const pricing = (variantId: string, unitPrice: number) => {
    const catalog = catalogPrices.get(variantId) ?? unitPrice;
    const special =
      getFranchisePrice(variantId) ?? getSubscriberPrice(variantId) ?? null;
    const effective =
      special !== null && special < catalog ? special : Math.min(unitPrice, catalog);
    return { catalog, effective, hasDiscount: effective < catalog };
  };
  if (!list.length) return null;

  return (
    <section className="mb-7" aria-labelledby="bag-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="bag-title" className="text-sm font-semibold text-slate-800">
          Produtos
        </h2>
        <span className="text-xs text-slate-500">
          {list.reduce((total, item) => total + item.quantity, 0)}{" "}
          {list.reduce((total, item) => total + item.quantity, 0) === 1
            ? "item"
            : "itens"}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {list.map((item, index) => (
          <article
            key={item.variantId}
            className={`flex gap-3 p-3.5 sm:items-center sm:gap-4 sm:p-4 ${index > 0 ? "border-t border-slate-100" : ""}`}
          >
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.productTitle}
                className="h-20 w-20 shrink-0 rounded-md bg-slate-50 object-contain p-1 sm:h-24 sm:w-24"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-slate-50 sm:h-24 sm:w-24">
                <PackageCheck className="h-7 w-7 text-slate-300" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800 sm:text-base">
                {item.productTitle}
              </p>
              {item.variantTitle && item.variantTitle !== "Default Title" && (
                <p className="mt-1 text-xs text-slate-500">
                  {item.variantTitle}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                {editable ? (
                  <div className="flex h-9 items-center overflow-hidden rounded-lg border border-slate-300">
                    <button
                      type="button"
                      disabled={busy || item.quantity <= 1}
                      onClick={() =>
                        onQuantity(item.variantId, item.quantity - 1)
                      }
                      className="flex h-full w-9 items-center justify-center text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-35"
                      aria-label={`Diminuir quantidade de ${item.productTitle}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="flex h-full min-w-9 items-center justify-center border-x border-slate-200 px-2 text-sm font-semibold">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        onQuantity(item.variantId, item.quantity + 1)
                      }
                      className="flex h-full w-9 items-center justify-center text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-35"
                      aria-label={`Aumentar quantidade de ${item.productTitle}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    Quantidade: <strong>{item.quantity}</strong>
                  </p>
                )}
                {(() => {
                  const { catalog, effective, hasDiscount } = pricing(
                    item.variantId,
                    item.unitPrice,
                  );
                  return (
                    <div className="text-right">
                      {hasDiscount && (
                        <p className="text-[11px] text-slate-400 line-through">
                          {money(catalog * item.quantity)}
                        </p>
                      )}
                      <p className="text-sm font-bold text-slate-950 sm:text-base">
                        {money(effective * item.quantity)}
                      </p>
                      {hasDiscount && (
                        <p className="text-[11px] font-semibold text-emerald-700">
                          Seu desconto aplicado
                        </p>
                      )}
                    </div>
                  );
                })()}

              </div>
            </div>
            {editable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(item.variantId)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                aria-label={`Remover ${item.productTitle}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
function RecommendedProducts({
  products,
  loading,
  busy,
  onAdd,
}: {
  products: ShopifyProduct[];
  loading: boolean;
  busy: boolean;
  onAdd: (product: ShopifyProduct) => Promise<void>;
}) {
  if (!loading && products.length === 0) return null;
  return (
    <section className="mt-9" aria-labelledby="recommended-title">
      <div className="mb-4">
        <h2
          id="recommended-title"
          className="text-lg font-bold text-slate-900 sm:text-xl"
        >
          Recomendações de itens em nossa loja
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Clique para adicionar diretamente à sacola
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-50"
              />
            ))
          : products.map((product) => (
              <RecommendedCard
                key={product.node.id}
                product={product}
                busy={busy}
                onAdd={onAdd}
              />
            ))}
      </div>
      <p className="mt-5 text-[11px] leading-relaxed text-slate-400">
        Produtos adicionados à sacola podem ter preço e disponibilidade
        atualizados antes da conclusão do pedido.
      </p>
    </section>
  );
}
function RecommendedCard({
  product,
  busy,
  onAdd,
}: {
  product: ShopifyProduct;
  busy: boolean;
  onAdd: (product: ShopifyProduct) => Promise<void>;
}) {
  const { getSubscriberPrice } = useSubscriberPrices();
  const { node } = product;
  const variant =
    node.variants.edges.find(({ node: item }) => item.availableForSale)?.node ||
    node.variants.edges[0]?.node;
  const image = node.images.edges[0]?.node;
  const price = Number(
    variant?.price.amount || node.priceRange.minVariantPrice.amount,
  );
  const compareAt = Number(variant?.compareAtPrice?.amount || 0);
  const subscriberPrice = variant ? getSubscriberPrice(variant.id) : null;
  const discountBase = compareAt > price ? compareAt : price;
  const effectiveDiscountPrice =
    subscriberPrice !== null && subscriberPrice < price
      ? subscriberPrice
      : price;
  const discount =
    discountBase > effectiveDiscountPrice
      ? Math.round(
          ((discountBase - effectiveDiscountPrice) / discountBase) * 100,
        )
      : 0;
  return (
    <button
      type="button"
      disabled={busy || !variant?.availableForSale}
      onClick={() => void onAdd(product)}
      className="group flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-3 text-left transition-[border-color,transform] hover:border-blue-400 active:scale-[0.99] disabled:opacity-60"
    >
      <div className="relative mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-slate-50">
        {discount > 0 && (
          <span className="absolute left-2 top-2 z-10 rounded bg-amber-200 px-2 py-1 text-[10px] font-bold text-slate-900">
            {discount}% OFF
          </span>
        )}
        {image ? (
          <img
            src={image.url}
            alt={image.altText || node.title}
            className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <PackageCheck className="h-8 w-8 text-slate-300" />
        )}
      </div>
      <p className="line-clamp-2 min-h-10 text-xs font-medium leading-snug text-slate-700 sm:text-sm">
        {node.title}
      </p>
      <div className="mt-2 min-h-[58px]">
        {compareAt > price && (
          <p className="text-[11px] text-slate-400 line-through">
            {money(compareAt)}
          </p>
        )}
        <p className="text-sm font-bold text-slate-950">{money(price)}</p>
        {subscriberPrice !== null && subscriberPrice < price && (
          <p className="mt-1 text-xs font-bold text-blue-700">
            {money(subscriberPrice)} para assinantes
          </p>
        )}
      </div>
      <span className="mt-2 text-xs font-semibold text-blue-700">
        Adicionar à sacola
      </span>
    </button>
  );
}
function SummaryTotals({
  summary,
  cartItems,
  shippingOverride,
  showServiceFee = true,
  cardPlan = null,
}: {
  summary: CheckoutSummary | null;
  cartItems: CartItem[];
  shippingOverride?: ShippingSummaryOverride;
  showServiceFee?: boolean;
  cardPlan?: InstallmentPlan | null;
}) {
  const { getSubscriberPrice } = useSubscriberPrices();
  const { getFranchisePrice } = useFranchisePrices();
  const cartSubtotal = cartItems.reduce(
    (total, item) => total + Number(item.price.amount) * item.quantity,
    0,
  );
  // Antes da sessão de checkout existir, o desconto de assinante/franquia
  // é calculado no cliente para já aparecer no resumo.
  const cartDiscount = cartItems.reduce((acc, item) => {
    const catalogPrice = Number(item.price.amount);
    const special =
      getFranchisePrice(item.variantId) ?? getSubscriberPrice(item.variantId);
    if (special === null || special >= catalogPrice) return acc;
    return acc + (catalogPrice - special) * item.quantity;
  }, 0);
  const subtotal = summary?.subtotal ?? cartSubtotal;
  const discount = summary?.discount ?? cartDiscount;
  const serviceFee = summary?.serviceFee ?? SERVICE_FEE;
  const appliedFee = showServiceFee ? serviceFee : 0;
  const shippingAmount = shippingOverride?.amount ?? summary?.shippingAmount ?? 0;
  const shippingMethod = shippingOverride?.title ?? summary?.shippingMethod;
  const liveTotal = Math.max(0, subtotal - discount + shippingAmount + appliedFee);
  const total = shippingOverride
    ? liveTotal
    : Math.max(0, (summary?.total ?? liveTotal) - (showServiceFee ? 0 : serviceFee));
  // No cartão o cliente paga a taxa da operadora: o total exibido acompanha o
  // valor realmente cobrado, calculado sobre o total já com desconto.
  const activeCardPlan =
    cardPlan && total > 0 ? installmentPlan(total, cardPlan.installments) : null;
  const cardInterest = activeCardPlan
    ? Math.max(0, Number((activeCardPlan.chargedTotal - total).toFixed(2)))
    : 0;
  const displayTotal = activeCardPlan ? activeCardPlan.chargedTotal : total;
  return (
    <div className="space-y-3 text-sm text-slate-600">
      <div className="flex justify-between">
        <span>Valor dos produtos</span>
        <span className="font-medium text-slate-900">{money(subtotal)}</span>
      </div>
      {discount > 0 && (
        <div className="flex justify-between text-emerald-700">
          <span>Total de descontos</span>
          <span className="font-semibold">-{money(discount)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span>{shippingMethod || "Entrega"}</span>
        <span className="font-medium text-slate-900">
          {shippingMethod ? (shippingAmount > 0 ? money(shippingAmount) : "Grátis") : "A calcular"}
        </span>
      </div>
      {showServiceFee && (
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          Taxa de serviço
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-800"
                aria-label="Entenda a taxa de serviço"
              >
                <CircleHelp className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-72 text-sm leading-relaxed text-slate-600">
              Esta taxa contribui para os custos de processamento, segurança e manutenção da nossa operação. Com ela, conseguimos acompanhar seu pedido, oferecer suporte quando necessário e manter uma experiência de compra rápida, confiável e organizada do início ao fim.
            </PopoverContent>
          </Popover>
        </span>
        <span className="font-medium text-slate-900">{money(serviceFee)}</span>
      </div>
      )}
      {cardInterest > 0 && (
        <div className="flex justify-between">
          <span>Juros do cartão</span>
          <span className="font-medium text-slate-900">
            +{money(cardInterest)}
          </span>
        </div>
      )}
      <div className="flex justify-between border-t border-slate-200 pt-4 text-xl font-bold text-slate-950">
        <span>Total</span>
        <span>{money(displayTotal)}</span>
      </div>
      {activeCardPlan && activeCardPlan.installments > 1 && (
        <p className="text-right text-xs text-slate-500">
          {activeCardPlan.installments}x de{" "}
          {money(activeCardPlan.installmentValue)} no cartão
        </p>
      )}
    </div>
  );
}
function OrderSummary({
  summary,
  cartItems,
  shippingOverride,
  showServiceFee = true,
  cardPlan = null,
}: {
  summary: CheckoutSummary | null;
  cartItems: CartItem[];
  shippingOverride?: ShippingSummaryOverride;
  showServiceFee?: boolean;
  cardPlan?: InstallmentPlan | null;
}) {
  return (
    <div className="mx-auto h-fit max-w-sm">
      <h2 className="mb-5 text-center text-xl font-bold text-slate-900">
        Resumo do pedido
      </h2>
      <SummaryTotals summary={summary} cartItems={cartItems} shippingOverride={shippingOverride} showServiceFee={showServiceFee} cardPlan={cardPlan} />
      <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-[#faf8f5] px-4 py-3 text-xs font-medium text-slate-600">
        <LockKeyhole className="h-4 w-4 text-blue-800" />
        Pagamento processado com segurança
      </div>
    </div>
  );
}
function MobileOrderSummary({
  summary,
  cartItems,
  shippingOverride,
  showServiceFee = true,
  cardPlan = null,
}: {
  summary: CheckoutSummary | null;
  cartItems: CartItem[];
  shippingOverride?: ShippingSummaryOverride;
  showServiceFee?: boolean;
  cardPlan?: InstallmentPlan | null;
}) {
  const itemCount =
    summary?.items.reduce((total, item) => total + item.quantity, 0) ??
    cartItems.reduce((total, item) => total + item.quantity, 0);
  const fee = showServiceFee ? SERVICE_FEE : 0;
  const cartTotal = cartItems.reduce(
    (total, item) => total + Number(item.price.amount) * item.quantity,
    0,
  ) + fee;
  const headerTotal = shippingOverride
    ? Math.max(
        0,
        (summary
          ? summary.subtotal - summary.discount + (showServiceFee ? summary.serviceFee ?? SERVICE_FEE : 0)
          : cartTotal) + shippingOverride.amount,
      )
    : Math.max(
        0,
        (summary?.total ?? cartTotal) -
          (showServiceFee ? 0 : summary?.serviceFee ?? SERVICE_FEE),
      );
  const headerDisplayTotal =
    cardPlan && headerTotal > 0
      ? installmentPlan(headerTotal, cardPlan.installments).chargedTotal
      : headerTotal;
  return (
    <details className="group overflow-hidden rounded-xl bg-slate-50">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <strong className="block text-sm text-slate-800">
            Resumo do pedido
          </strong>
          <span className="text-xs text-slate-400">
            {itemCount} {itemCount === 1 ? "item" : "itens"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm font-bold text-blue-950">
          {money(headerDisplayTotal)}
          <ChevronDown className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-slate-200 bg-white px-3.5 py-4">
        <SummaryTotals summary={summary} cartItems={cartItems} shippingOverride={shippingOverride} showServiceFee={showServiceFee} cardPlan={cardPlan} />
      </div>
    </details>
  );
}
function Success({
  payment,
  summary,
}: {
  payment: PaymentResult | null;
  summary: CheckoutSummary | null;
}) {
  const pickup = summary?.shippingCode === "pick_up";
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg text-center">
        <img src={logo} alt="TudoPraPet" className="mx-auto mb-10 w-56" />
        <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-emerald-600" />
        <h1 className="text-3xl font-bold">Pedido recebido!</h1>
        <p className="mt-3 text-slate-600">
          {payment?.status === "credit_approved"
            ? "Pedido aprovado no prazo da franquia."
            : "Pagamento confirmado e pedido em preparação."}
        </p>
        {pickup && (
          <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-left">
            <p className="text-lg font-bold text-amber-950">
              Aguarde o aviso de pedido pronto
            </p>
            <p className="mt-2 text-sm leading-relaxed text-amber-900">
              Seu pagamento foi confirmado, mas a retirada ainda não está
              liberada. Não se desloque até a loja agora. Enviaremos uma
              confirmação quando os produtos estiverem separados e prontos para
              retirada.
            </p>
            {PICKUP_STORE_ADDRESS && PICKUP_STORE_HOURS ? (
              <div className="mt-4 space-y-3 rounded-xl bg-white/75 p-4 text-slate-800">
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-blue-900" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Local de retirada
                    </p>
                    <p className="mt-1 text-sm font-semibold">{PICKUP_STORE_ADDRESS}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Store className="mt-0.5 h-5 w-5 shrink-0 text-blue-900" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Horário de funcionamento
                    </p>
                    <p className="mt-1 text-sm font-semibold">{PICKUP_STORE_HOURS}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold text-amber-950">
                O endereço e o horário de retirada serão informados junto com o
                aviso de pedido pronto.
              </p>
            )}
          </div>
        )}
        {payment?.invoiceUrl && (
          <Button className="mt-6" asChild>
            <a href={payment.invoiceUrl} target="_blank" rel="noreferrer">
              Ver cobrança
            </a>
          </Button>
        )}
        <div className="mt-4">
          <Button variant="outline" asChild>
            <Link to="/meus-pedidos">Ver meus pedidos</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
function AccountRequiredCheckout() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <img src={logo} alt="TudoPraPet" className="mx-auto mb-8 w-48" />
        <UserRound className="mx-auto h-12 w-12 text-blue-900" />
        <h1 className="mt-4 text-2xl font-bold text-slate-950">
          Entre para finalizar sua compra
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Para proteger seus dados, todos os pedidos da TudoPraPet exigem uma
          conta.
        </p>
        <Button
          asChild
          size="lg"
          className="mt-6 h-12 w-full bg-blue-900 hover:bg-blue-800"
        >
          <Link to="/login">Entrar na minha conta</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="mt-3 h-12 w-full"
        >
          <Link to="/cadastro">Criar uma conta</Link>
        </Button>
        <Button asChild variant="link" className="mt-2">
          <Link to="/carrinho">Voltar à sacola</Link>
        </Button>
      </div>
    </main>
  );
}
function Centered({ title, text }: { title: string; text: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <img src={logo} alt="TudoPraPet" className="mx-auto mb-8 w-56" />
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-slate-600">{text}</p>
        <Button className="mt-6" asChild>
          <Link to="/carrinho">Voltar ao carrinho</Link>
        </Button>
      </div>
    </main>
  );
}
