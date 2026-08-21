export interface CardFormValue {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export type CardField = keyof CardFormValue;
export type CardErrors = Partial<Record<CardField, string>>;

export const cardDigits = (value: string) => value.replace(/\D/g, "");

export function formatCardNumber(value: string): string {
  return cardDigits(value).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function isValidCardNumber(value: string): boolean {
  const number = cardDigits(value);
  if (number.length < 13 || number.length > 19 || /^(\d)\1+$/.test(number)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = number.length - 1; index >= 0; index--) {
    let digit = Number(number[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function validateCard(value: CardFormValue, now = new Date()): CardErrors {
  const errors: CardErrors = {};
  const holderName = value.holderName.trim().replace(/\s+/g, " ");
  const nameLetters = holderName.match(/\p{L}/gu)?.length ?? 0;
  if (holderName.length < 3 || nameLetters < 2 || !/^[\p{L}\s.'-]+$/u.test(holderName)) {
    errors.holderName = "Digite o nome do titular exatamente como aparece no cartão.";
  }

  const number = cardDigits(value.number);
  if (!isValidCardNumber(number)) errors.number = "Digite um número de cartão válido.";

  const month = Number(cardDigits(value.expiryMonth));
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    errors.expiryMonth = "Mês inválido.";
  }
  const rawYear = cardDigits(value.expiryYear);
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  if (!/^\d{2}$|^\d{4}$/.test(rawYear) || year < now.getFullYear() || year > now.getFullYear() + 25) {
    errors.expiryYear = "Ano inválido.";
  } else if (!errors.expiryMonth && year === now.getFullYear() && month < now.getMonth() + 1) {
    errors.expiryMonth = "Este cartão está vencido.";
  }

  const ccv = cardDigits(value.ccv);
  const isAmex = /^3[47]/.test(number);
  if (isAmex ? !/^\d{4}$/.test(ccv) : !/^\d{3}$/.test(ccv)) {
    errors.ccv = isAmex ? "O CVV deste cartão deve ter 4 dígitos." : "O CVV deve ter 3 dígitos.";
  }
  return errors;
}

