import { Skeleton } from "@/components/ui/skeleton";

export const ProductCardSkeleton = () => (
  <div className="flex w-full flex-col" aria-hidden="true">
    <Skeleton className="aspect-square w-full rounded-lg" />
    <div className="mt-4 space-y-2">
      <Skeleton className="h-4 w-[92%]" />
      <Skeleton className="h-4 w-[66%]" />
    </div>
    <div className="mt-4 space-y-2">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-3 w-32" />
    </div>
  </div>
);
