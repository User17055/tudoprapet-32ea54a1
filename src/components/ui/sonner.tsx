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
      closeButton
      richColors
      gap={10}
      offset={16}
      mobileOffset={12}
      icons={{
        success: <CheckCircle2 className="h-5 w-5" />,
        error: <XCircle className="h-5 w-5" />,
        warning: <AlertTriangle className="h-5 w-5" />,
        info: <Info className="h-5 w-5" />,
        loading: <Loader2 className="h-5 w-5 animate-spin" />,
      }}
      toastOptions={{
        duration: 4500,
        classNames: {
          toast:
            "group toast !w-[min(92vw,420px)] !rounded-2xl !border-2 !px-4 !py-3.5 !font-medium !shadow-[0_14px_40px_-12px_rgba(15,23,42,0.35)] backdrop-blur-sm",
          success:
            "!border-emerald-500/50 !bg-emerald-50 !text-emerald-950 dark:!border-emerald-400/40 dark:!bg-emerald-950 dark:!text-emerald-50",
          error:
            "!border-red-500/55 !bg-red-50 !text-red-950 dark:!border-red-400/45 dark:!bg-red-950 dark:!text-red-50",
          warning:
            "!border-amber-500/55 !bg-amber-50 !text-amber-950 dark:!border-amber-400/45 dark:!bg-amber-950 dark:!text-amber-50",
          info:
            "!border-sky-500/50 !bg-sky-50 !text-sky-950 dark:!border-sky-400/40 dark:!bg-sky-950 dark:!text-sky-50",
          loading:
            "!border-blue-500/50 !bg-blue-50 !text-blue-950 dark:!border-blue-400/40 dark:!bg-blue-950 dark:!text-blue-50",
          title: "!text-[15px] !font-bold !leading-snug",
          description: "!text-sm !font-medium !leading-snug !text-current !opacity-75",
          icon: "!mr-1 !h-6 !w-6 !shrink-0",
          closeButton:
            "!right-2 !top-2 !left-auto !translate-x-0 !translate-y-0 !border-current/15 !bg-white/70 !text-current hover:!bg-white dark:!bg-black/30",
          actionButton: "!rounded-full !bg-primary !px-3 !font-bold !text-primary-foreground",
          cancelButton: "!rounded-full !bg-black/10 !px-3 !font-semibold !text-current",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
