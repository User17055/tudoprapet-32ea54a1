import { ExternalLink, FileText, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { invoiceState, TONE_CLASSES, type SaleInvoice } from "@/lib/saleOrders";
import { cn } from "@/lib/utils";

/**
 * Pedido de venda + nota fiscal de uma venda. Aparece para cliente e para
 * franqueado: toda venda tem os dois.
 */
export function SaleDocuments({
  saleOrderNumber,
  invoice,
  className,
}: {
  saleOrderNumber: string | null;
  invoice: SaleInvoice | null;
  className?: string;
}) {
  const state = invoiceState(invoice);
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)}>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <ReceiptText className="h-4 w-4" />
        {saleOrderNumber ? (
          <>Pedido de venda <strong className="text-foreground">nº {saleOrderNumber}</strong></>
        ) : (
          "Pedido de venda em registro"
        )}
      </span>
      <Badge variant="outline" className={cn("gap-1", TONE_CLASSES[state.tone])}>
        <FileText className="h-3 w-3" />
        {state.label}
      </Badge>
      {invoice?.url && invoice.status !== "rejected" && (
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2.5" asChild>
          <a href={invoice.url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3 w-3" /> Ver nota fiscal
          </a>
        </Button>
      )}
    </div>
  );
}
