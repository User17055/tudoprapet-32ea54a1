// Espelho de supabase/functions/_shared/pricing.ts (parte de parcelamento).
// O servidor é a fonte da verdade do valor cobrado; aqui só exibimos as opções.
// src/test/installments.test.ts garante que os dois cálculos batem.

export const MAX_INSTALLMENTS = 12;
export const MIN_INSTALLMENT_VALUE = 5;
export const CARD_OPERATION_FEE = 0.49;

export function cardFeePercent(installments: number): number {
  if (installments <= 1) return 2.99;
  return installments <= 6 ? 3.49 : 3.99;
}

export interface InstallmentPlan {
  installments: number;
  installmentValue: number;
  chargedTotal: number;
  interestAmount: number;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function maxInstallmentsFor(total: number): number {
  const limit = Math.floor(total / MIN_INSTALLMENT_VALUE);
  return Math.max(1, Math.min(MAX_INSTALLMENTS, limit || 1));
}

export function installmentPlan(total: number, installments: number): InstallmentPlan {
  const n = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.trunc(installments) || 1));
  const percent = cardFeePercent(n) / 100;
  const gross = (total + CARD_OPERATION_FEE) / (1 - percent);
  const installmentValue = Math.ceil((gross / n) * 100) / 100;
  const chargedTotal = round2(installmentValue * n);
  return {
    installments: n,
    installmentValue,
    chargedTotal,
    interestAmount: round2(chargedTotal - total),
  };
}

export function installmentOptions(total: number): InstallmentPlan[] {
  const max = maxInstallmentsFor(total);
  const options: InstallmentPlan[] = [];
  for (let n = 1; n <= max; n += 1) options.push(installmentPlan(total, n));
  return options;
}

export function installmentLabel(plan: InstallmentPlan, money: (v: number) => string): string {
  if (plan.installments === 1) return `1x de ${money(plan.chargedTotal)} (à vista)`;
  return `${plan.installments}x de ${money(plan.installmentValue)} — total ${money(plan.chargedTotal)}`;
}
