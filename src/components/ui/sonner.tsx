import { useTheme } from "next-themes";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      gap={8}
      offset={12}
      mobileOffset={8}
      icons={{
        success: <CheckCircle2 className="h-5 w-5" />,
        error: <XCircle className="h-5 w-5" />,
        warning: <AlertTriangle className="h-5 w-5" />,
        info: <Info className="h-5 w-5" />,
        loading: <Loader2 className="h-5 w-5 animate-spin" />,
      }}
      toastOptions={{
        duration: 4000,

        // A borda de cada variante usa --toast-accent, definida em index.css a
        // partir dos tokens da marca. Antes eram hex fixos do Bootstrap.
        classNames: {
          toast:
            "group toast !w-[min(92vw,360px)] !rounded-xl !border-0 !bg-white !px-4 !py-3 !gap-3 !font-sans !text-slate-900 !shadow-lg",
          success: "toast-success",
          error: "toast-error",
          warning: "toast-warning",
          info: "toast-info",
          loading: "toast-loading",
          title: "!text-[14px] !font-bold !leading-snug !text-foreground",
          content: "!min-w-0 !flex-1",
          description:
            "!mt-1 !block !text-[13px] !font-normal !leading-snug !text-muted-foreground !whitespace-normal !break-words",
          icon: "!mr-1 !flex !h-8 !w-8 !shrink-0 !items-center !justify-center !rounded-full !bg-slate-100",
          actionButton:
            "!rounded-full !bg-primary !px-3 !py-1.5 !text-xs !font-bold !text-primary-foreground",
          cancelButton:
            "!rounded-full !bg-muted !px-3 !py-1.5 !text-xs !font-semibold !text-foreground",
        },
      }}
      {...props}
    />

  );
};

export { Toaster, toast };
