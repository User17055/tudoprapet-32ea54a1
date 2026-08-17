import { toast } from "sonner";

export function notifyCartItemAdded() {
  toast.success("Adicionado à sacola", {
    duration: 1800,
    position: "bottom-right",
    closeButton: false,
    className: "!w-auto !max-w-[calc(100vw-2rem)] !rounded-xl !px-3 !py-2.5 !shadow-lg",
    classNames: {
      content: "!pr-0",
      title: "!text-sm !font-semibold",
      icon: "!mr-0 !h-6 !w-6 !bg-emerald-50 !text-emerald-600",
    },
  });
}

export function notifyCartItemAddFailed() {
  toast.error("Não foi possível adicionar", {
    duration: 2600,
    position: "bottom-right",
    closeButton: false,
    className: "!w-auto !max-w-[calc(100vw-2rem)] !rounded-xl !px-3 !py-2.5 !shadow-lg",
    classNames: {
      content: "!pr-0",
      title: "!text-sm !font-semibold",
      icon: "!mr-0 !h-6 !w-6",
    },
  });
}
