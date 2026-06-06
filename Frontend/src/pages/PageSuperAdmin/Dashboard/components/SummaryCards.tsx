import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";

export interface SummaryCardItem {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
}

interface SummaryCardsProps {
  items: SummaryCardItem[];
  loading?: boolean;
}

export function SummaryCards({ items, loading = false }: SummaryCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={`summary-skeleton-${index}`} className="border border-gray-200">
            <CardHeader className="space-y-3 pb-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-7 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <Card key={item.title} className="border border-gray-200">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-gray-600">
                <Icon className="h-4 w-4" />
                {item.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">{item.value}</div>
              <p className="mt-2 text-sm text-gray-500">{item.subtitle}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
