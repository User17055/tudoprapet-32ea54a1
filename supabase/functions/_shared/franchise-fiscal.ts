import { validCnpj, validCpf } from "./checkout-input.ts";

export type StateRegistrationIndicator = "contributor" | "exempt" | "non_contributor";
export type InvoicePurpose = "resale" | "final_consumption";

export interface FranchiseFiscalProfile {
  name?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  company_legal_name?: string | null;
  company_trade_name?: string | null;
  state_registration?: string | null;
  state_registration_indicator?: string | null;
}

/** Identidade fiscal única do pedido de franquia, resolvida só no servidor. */
export interface FranchiseFiscalIdentity {
  documentType: "cpf" | "cnpj";
  cpfCnpj: string;
  name: string;
  legalName: string;
  tradeName: string;
  stateRegistration: string;
  stateRegistrationIndicator: StateRegistrationIndicator;
}

export type FiscalIdentityResult =
  | { ok: true; identity: FranchiseFiscalIdentity }
  | { ok: false; error: string };

const onlyDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const text = (value: unknown) => String(value ?? "").trim();
const INDICATORS = ["contributor", "exempt", "non_contributor"];

function companyIdentity(profile: FranchiseFiscalProfile, purpose: InvoicePurpose): FiscalIdentityResult {
  const legalName = text(profile.company_legal_name);
  if (legalName.length < 2) return { ok: false, error: "Informe a razão social no perfil da franquia" };
  const cnpj = onlyDigits(profile.cnpj);
  if (!validCnpj(cnpj)) return { ok: false, error: "Informe um CNPJ válido no perfil da franquia" };
  const indicator = String(profile.state_registration_indicator || "");
  if (!INDICATORS.includes(indicator)) {
    return { ok: false, error: "Informe a situação da inscrição estadual no perfil da franquia" };
  }
  const ie = onlyDigits(profile.state_registration);
  if (indicator === "contributor" && !/^\d{2,14}$/.test(ie)) {
    return { ok: false, error: "Informe uma inscrição estadual válida no perfil da franquia" };
  }
  if (purpose === "resale" && indicator !== "contributor") {
    return { ok: false, error: "Compras para revenda exigem cadastro como contribuinte de ICMS e inscrição estadual" };
  }
  return {
    ok: true,
    identity: {
      documentType: "cnpj",
      cpfCnpj: cnpj,
      name: legalName,
      legalName,
      tradeName: text(profile.company_trade_name),
      // A IE só segue junto quando a empresa é contribuinte.
      stateRegistration: indicator === "contributor" ? ie : "",
      stateRegistrationIndicator: indicator as StateRegistrationIndicator,
    },
  };
}

/**
 * Revenda: sempre CNPJ + razão social + contribuinte + IE.
 * Consumo final: CPF pessoal (nome da pessoa, não contribuinte, sem IE);
 * se não houver CPF cadastrado, usa o CNPJ explicitamente cadastrado.
 * Nunca lê o documento digitado no navegador.
 */
export function resolveFranchiseFiscalIdentity(
  profile: FranchiseFiscalProfile | null,
  purpose: InvoicePurpose | null | undefined,
): FiscalIdentityResult {
  if (purpose !== "resale" && purpose !== "final_consumption") {
    return { ok: false, error: "Escolha se a nota fiscal será para revenda ou consumo final" };
  }
  if (!profile) return { ok: false, error: "Complete o perfil fiscal da franquia" };
  if (purpose === "resale") return companyIdentity(profile, purpose);

  const cpf = onlyDigits(profile.cpf);
  if (cpf) {
    if (!validCpf(cpf)) return { ok: false, error: "Informe um CPF válido no perfil" };
    const name = text(profile.name);
    if (name.length < 2) return { ok: false, error: "Informe seu nome completo no perfil" };
    return {
      ok: true,
      identity: {
        documentType: "cpf",
        cpfCnpj: cpf,
        name,
        legalName: "",
        tradeName: "",
        stateRegistration: "",
        stateRegistrationIndicator: "non_contributor",
      },
    };
  }
  if (onlyDigits(profile.cnpj)) return companyIdentity(profile, purpose);
  return { ok: false, error: "Cadastre um CPF ou CNPJ no perfil para a nota de consumo final" };
}

/** Confere se um snapshot salvo ainda é uma identidade fiscal válida para a finalidade. */
export function validateFiscalSnapshot(
  snapshot: Partial<FranchiseFiscalIdentity> | null | undefined,
  purpose: InvoicePurpose | null | undefined,
): string | null {
  if (!snapshot) return "Complete o perfil fiscal da franquia";
  const doc = onlyDigits(snapshot.cpfCnpj);
  if (doc.length === 11) {
    if (purpose === "resale") return "Compras para revenda exigem CNPJ";
    if (!validCpf(doc)) return "Informe um CPF válido no perfil";
    if (text(snapshot.name).length < 2) return "Informe seu nome completo no perfil";
    if (onlyDigits(snapshot.stateRegistration)) return "Consumo final com CPF não usa inscrição estadual";
    return null;
  }
  const result = companyIdentity({
    cnpj: doc,
    company_legal_name: snapshot.legalName || snapshot.name,
    company_trade_name: snapshot.tradeName,
    state_registration: snapshot.stateRegistration,
    state_registration_indicator: snapshot.stateRegistrationIndicator,
  }, purpose === "resale" ? "resale" : "final_consumption");
  return result.ok ? null : result.error;
}

/** Compatibilidade: mensagem de erro do perfil para a finalidade. */
export function franchiseFiscalError(
  profile: FranchiseFiscalProfile | null,
  invoicePurpose?: InvoicePurpose | null,
): string | null {
  const result = resolveFranchiseFiscalIdentity(profile, invoicePurpose ?? "resale");
  return result.ok ? null : result.error;
}
