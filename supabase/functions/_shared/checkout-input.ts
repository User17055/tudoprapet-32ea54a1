import { parseCheckoutItems, type ValidationResult } from "./validation.ts";

export interface CheckoutCustomerInput {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone: string;
}

export interface CheckoutAddressInput {
  address1: string;
  address2?: string;
  number: string;
  neighborhood: string;
  city: string;
  provinceCode: string;
  postalCode: string;
  countryCode: "BR";
}

export interface CheckoutPrepareInput {
  items: Array<{ variantId: string; quantity: number }>;
  customer: CheckoutCustomerInput;
  delivery: {
    code: "pick_up" | "pac" | "sedex" | "local_delivery" | "shipping";
    optionHandle?: string;
    address?: CheckoutAddressInput;
  };
  billingAddress?: CheckoutAddressInput;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function validCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index++) sum += Number(value[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return (remainder === 10 ? 0 : remainder) === Number(value[length]);
  };
  return check(9) && check(10);
}

function validCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const calculate = (length: 12 | 13) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
    const remainder = sum % 11;
    return (remainder < 2 ? 0 : 11 - remainder) === Number(value[length]);
  };
  return calculate(12) && calculate(13);
}

export function validCpfCnpj(value: string): boolean {
  const normalized = digits(value);
  return normalized.length === 11 ? validCpf(normalized) : validCnpj(normalized);
}

export function parseCheckoutAddress(raw: unknown): ValidationResult<CheckoutAddressInput> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const address: CheckoutAddressInput = {
    address1: clean(source.address1, 160),
    address2: clean(source.address2, 160) || undefined,
    number: clean(source.number, 32),
    neighborhood: clean(source.neighborhood, 100),
    city: clean(source.city, 100),
    provinceCode: clean(source.provinceCode, 2).toUpperCase(),
    postalCode: digits(clean(source.postalCode, 16)),
    countryCode: "BR",
  };
  if (!address.address1 || !address.number || !address.neighborhood || !address.city ||
    !/^[A-Z]{2}$/.test(address.provinceCode) || address.postalCode.length !== 8) {
    return { ok: false, message: "Preencha o endereço completo" };
  }
  return { ok: true, value: address };
}

export function parseCheckoutCustomer(raw: unknown): ValidationResult<CheckoutCustomerInput> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const customer: CheckoutCustomerInput = {
    name: clean(source.name, 160),
    email: clean(source.email, 254).toLowerCase(),
    cpfCnpj: digits(clean(source.cpfCnpj, 24)),
    mobilePhone: digits(clean(source.mobilePhone, 24)),
  };
  if (customer.name.length < 2) return { ok: false, message: "Informe o nome completo" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    return { ok: false, message: "Informe um e-mail válido" };
  }
  if (!validCpfCnpj(customer.cpfCnpj)) {
    return { ok: false, message: "Informe um CPF ou CNPJ válido" };
  }
  if (customer.mobilePhone.length < 10 || customer.mobilePhone.length > 11) {
    return { ok: false, message: "Informe um telefone válido" };
  }
  return { ok: true, value: customer };
}

export function parseCheckoutPrepareInput(raw: unknown): ValidationResult<CheckoutPrepareInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Dados do checkout inválidos" };
  }
  const body = raw as Record<string, unknown>;
  const parsedItems = parseCheckoutItems(body.items);
  if (!parsedItems.ok) return { ok: false, message: parsedItems.message };

  const parsedCustomer = parseCheckoutCustomer(body.customer);
  if (!parsedCustomer.ok) return { ok: false, message: parsedCustomer.message };
  const customer = parsedCustomer.value;

  const sourceDelivery = body.delivery && typeof body.delivery === "object"
    ? body.delivery as Record<string, unknown>
    : {};
  const code = clean(sourceDelivery.code, 32) as CheckoutPrepareInput["delivery"]["code"];
  if (!["pick_up", "pac", "sedex", "local_delivery", "shipping"].includes(code)) {
    return { ok: false, message: "Escolha uma forma de entrega válida" };
  }

  let address: CheckoutAddressInput | undefined;
  const optionHandle = clean(sourceDelivery.optionHandle, 500) || undefined;
  if (code !== "pick_up") {
    const parsedAddress = parseCheckoutAddress(sourceDelivery.address);
    if (!parsedAddress.ok) {
      return { ok: false, message: "Preencha o endereço de entrega completo" };
    }
    address = parsedAddress.value;
    if (!optionHandle) return { ok: false, message: "Escolha uma modalidade de frete" };
  }

  let billingAddress: CheckoutAddressInput | undefined;
  if (body.billingAddress) {
    const parsedBilling = parseCheckoutAddress(body.billingAddress);
    if (!parsedBilling.ok) return { ok: false, message: "Preencha o endereço de cobrança completo" };
    billingAddress = parsedBilling.value;
  }

  return {
    ok: true,
    value: { items: parsedItems.value, customer, delivery: { code, optionHandle, address }, billingAddress },
  };
}

export function shippingLabel(code: CheckoutPrepareInput["delivery"]["code"]): string {
  return {
    pick_up: "Retirada na loja",
    pac: "PAC",
    sedex: "SEDEX",
    local_delivery: "Motoboy",
    shipping: "Envio",
  }[code];
}
