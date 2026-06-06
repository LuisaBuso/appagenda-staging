import { Card, CardContent } from '../../components/ui/card';

export function TopServices() {
  const services = [
    { name: "Haircut", bookings: "14" },
    { name: "Hair Coloring", bookings: "12" },
    { name: "Hair Styling", bookings: "10" },
  ];

  return (
    <Card className="bg-white border border-gray-200 shadow-sm rounded-lg">
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Top services</h2>
        <div className="space-y-3">
          {services.map((service) => (
            <div key={service.name} className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">{service.name}</span>
              <span className="text-base font-semibold text-gray-900">{service.bookings}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
