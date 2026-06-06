import { CreditCard, Loader2, Wallet, WalletCards } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { formatMoney } from "./utils";

interface GiftCardsSummaryCardsProps {
  activeCount: number;
  totalIssued: number;
  pendingBalance: number;
  currency: string;
  isRefreshing: boolean;
}

export function GiftCardsSummaryCards({
  activeCount,
  totalIssued,
  pendingBalance,
  currency,
  isRefreshing,
}: GiftCardsSummaryCardsProps) {
  const metrics = [
    {
      title: "Gift Cards activas",
      value: String(activeCount),
      icon: CreditCard,
      iconStyles: "text-slate-700",
    },
    {
      title: "Saldo total emitido",
      value: formatMoney(totalIssued, currency),
      icon: WalletCards,
      iconStyles: "text-slate-700",
    },
    {
      title: "Saldo pendiente",
      value: formatMoney(pendingBalance, currency),
      icon: Wallet,
      iconStyles: "text-slate-700",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {metrics.map((metric) => {
        const Icon = metric.icon;

        return (
          <Card key={metric.title} className="border-gray-300 transition-colors hover:border-gray-400">
            <CardContent className="pt-6">
              <div className="mb-2 flex items-center gap-2">
                <div className="rounded-lg border border-gray-300 p-2">
                  {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin text-gray-500" /> : <Icon className={`h-4 w-4 ${metric.iconStyles}`} />}
                </div>
                <p className="text-sm font-medium text-gray-700">{metric.title}</p>
              </div>
              <p className="text-2xl font-bold text-black">{metric.value}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
