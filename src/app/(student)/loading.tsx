import { Skeleton } from "@/components/ui/skeleton";

export default function StudentLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-4 md:px-8 md:pt-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
