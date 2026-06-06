import { Card, CardContent } from '../../components/ui/card';

export function KPIMetrics() {
  const kpis = [
    { name: "Bookings", value: "36" },
    { name: "Revenue", value: "$1,200" },
    { name: "New clients", value: "4" }
  ];

  return (
    <Card className="bg-white border border-gray-200 shadow-sm rounded-lg">
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's KPIs</h2>
        <div className="space-y-3">
          {kpis.map((kpi) => (
            <div key={kpi.name} className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">{kpi.name}</span>
              <span className="text-base font-semibold text-gray-900">{kpi.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
