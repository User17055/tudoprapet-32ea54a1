export const PRESIDENTE_PRUDENTE_LOCAL_HANDLE = "tpp-local-presidente-prudente";
export const PRESIDENTE_PRUDENTE_LOCAL_FEE = 10;

type DeliveryAddress = { city?: string; provinceCode?: string };
type DeliveryOption = {
  handle: string;
  code: string | null;
  title: string;
  description: string | null;
  deliveryMethodType: string;
  amount: number;
  currencyCode: string;
};

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLowerCase();

export function isPresidentePrudente(address: DeliveryAddress): boolean {
  return normalize(address.city || "") === "presidente prudente" &&
    normalize(address.provinceCode || "") === "sp";
}

function isLocalDelivery(option: DeliveryOption): boolean {
  const label = normalize(`${option.code || ""} ${option.title} ${option.description || ""}`);
  return option.deliveryMethodType === "LOCAL" || /motoboy|entrega local|presidente prudente/.test(label);
}

export function applyDeliveryPolicy(
  address: DeliveryAddress,
  providerOptions: DeliveryOption[],
): DeliveryOption[] {
  const carrierOptions = providerOptions.filter((option) => !isLocalDelivery(option));
  if (!isPresidentePrudente(address)) return carrierOptions;
  return [{
    handle: PRESIDENTE_PRUDENTE_LOCAL_HANDLE,
    code: "LOCAL_DELIVERY",
    title: "Entrega em Presidente Prudente",
    description: "Entrega local para endereços de Presidente Prudente/SP",
    deliveryMethodType: "LOCAL",
    amount: PRESIDENTE_PRUDENTE_LOCAL_FEE,
    currencyCode: "BRL",
  }, ...carrierOptions];
}
