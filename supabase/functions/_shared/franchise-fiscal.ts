export type StateRegistrationIndicator = "contributor" | "exempt" | "non_contributor";

export interface FranchiseFiscalProfile {
  cnpj?: string | null;
  company_legal_name?: string | null;
  company_trade_name?: string | null;
  state_registration?: string | null;
  state_registration_indicator?: string | null;
}

export function franchiseFiscalError(
  profile: FranchiseFiscalProfile | null,
  invoicePurpose?: "resale" | "final_consumption" | null,
): string | null {
  if (!profile || String(profile.company_legal_name || "").trim().length < 2) {
    return "Informe a razão social no perfil da franquia";
  }
  if (String(profile.cnpj || "").replace(/\D/g, "").length !== 14) {
    return "Informe um CNPJ válido no perfil da franquia";
  }
  const indicator = profile.state_registration_indicator;
  if (!["contributor", "exempt", "non_contributor"].includes(String(indicator))) {
    return "Informe a situação da inscrição estadual no perfil da franquia";
  }
  const stateRegistration = String(profile.state_registration || "").replace(/\D/g, "");
  if (indicator === "contributor" && !/^\d{2,14}$/.test(stateRegistration)) {
    return "Informe uma inscrição estadual válida no perfil da franquia";
  }
  if (invoicePurpose === "resale" && indicator !== "contributor") {
    return "Compras para revenda exigem cadastro como contribuinte de ICMS e inscrição estadual";
  }
  return null;
}
