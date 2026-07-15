import { useEffect } from "react";
import { useTheme } from "next-themes";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { gsap } from "gsap";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const animateToast = (toastElement: HTMLElement) => {
      if (toastElement.dataset.gsapAnimated === "true") return;
      toastElement.dataset.gsapAnimated = "true";

      const progressTrack = document.createElement("div");
      const progressFill = document.createElement("div");
      progressTrack.className = "pet-toast-progress";
      progressFill.className = "pet-toast-progress-fill";
      progressTrack.setAttribute("aria-hidden", "true");
      progressTrack.appendChild(progressFill);
      toastElement.appendChild(progressTrack);

      if (prefersReducedMotion) return;

      const content = toastElement.querySelector<HTMLElement>("[data-content]");
      const icon = toastElement.querySelector<HTMLElement>("[data-icon]");
      const timeline = gsap.timeline();

      timeline.fromTo(
        toastElement,
        { opacity: 0, boxShadow: "0 0 0 rgba(15, 23, 42, 0)" },
        {
          opacity: 1,
          boxShadow: "0 18px 48px -14px rgba(15, 23, 42, 0.42)",
          duration: 0.38,
          ease: "power2.out",
          onComplete: () => gsap.set(toastElement, { clearProps: "opacity" }),
        },
      );

      if (content) {
        timeline.fromTo(
          content,
          { opacity: 0, x: -10 },
          { opacity: 1, x: 0, duration: 0.38, ease: "power3.out" },
          0.05,
        );
      }

      if (icon) {
        timeline.fromTo(
          icon,
          { opacity: 0, scale: 0.35, rotate: -22 },
          { opacity: 1, scale: 1, rotate: 0, duration: 0.55, ease: "back.out(2.6)" },
          0.02,
        );
      }
    };

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches("[data-sonner-toast]")) animateToast(node);
          node.querySelectorAll<HTMLElement>("[data-sonner-toast]").forEach(animateToast);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-right"
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
        duration: 4000,
        closeButtonAriaLabel: "Fechar notificação",
        classNames: {
          toast:
            "group toast pet-toast !w-[min(92vw,390px)] !overflow-hidden !rounded-2xl !border !px-4 !py-3.5 !gap-3 !font-sans !shadow-[0_14px_40px_-12px_rgba(15,23,42,0.28)] backdrop-blur-md",
          success:
            "toast-success !border-emerald-500/40 !bg-white !text-slate-900 dark:!border-emerald-400/40 dark:!bg-slate-950 dark:!text-slate-50",
          error:
            "toast-error !border-red-500/40 !bg-white !text-slate-900 dark:!border-red-400/40 dark:!bg-slate-950 dark:!text-slate-50",
          warning:
            "toast-warning !border-amber-500/45 !bg-white !text-slate-900 dark:!border-amber-400/45 dark:!bg-slate-950 dark:!text-slate-50",
          info:
            "toast-info !border-sky-500/40 !bg-white !text-slate-900 dark:!border-sky-400/40 dark:!bg-slate-950 dark:!text-slate-50",
          loading:
            "toast-loading !border-slate-300 !bg-white !text-slate-900 dark:!border-slate-600 dark:!bg-slate-950 dark:!text-slate-50",
          title: "!text-[14px] !font-bold !leading-snug !text-slate-900 dark:!text-slate-50",
          content: "!min-w-0 !flex-1 !pr-6",
          description: "!mt-1 !block !text-[13px] !font-normal !leading-snug !text-slate-600 dark:!text-slate-300 !whitespace-normal !break-words",
          icon: "pet-toast-icon !mr-1 !flex !h-9 !w-9 !shrink-0 !items-center !justify-center !rounded-full !bg-black/[0.04] dark:!bg-white/10",
          closeButton:
            "!right-2 !top-2 !left-auto !translate-x-0 !translate-y-0 !h-6 !w-6 !border-transparent !bg-black/5 !text-slate-600 hover:!bg-black/10 hover:!text-slate-900 dark:!bg-white/10 dark:!text-slate-300 dark:hover:!bg-white/20",
          actionButton: "!rounded-full !bg-primary !px-3 !py-1.5 !text-xs !font-bold !text-primary-foreground",
          cancelButton: "!rounded-full !bg-black/10 !px-3 !py-1.5 !text-xs !font-semibold !text-current",
        },
      }}
      {...props}
    />

  );
};

export { Toaster, toast };
