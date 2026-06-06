import { Card, CardContent } from '../../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';

export function TopStylists() {
  const stylists = [
    { name: "Lydia Baker", bookings: "14", initials: "LB" },
    { name: "Emily Roberts", bookings: "12", initials: "ER" },
    { name: "Olivia Wilson", bookings: "10", initials: "OW" },
  ];

  return (
    <Card className="bg-white border border-gray-200 shadow-sm rounded-lg">
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Top stylists</h2>
        <div className="space-y-3">
          {stylists.map((stylist) => (
            <div key={stylist.name} className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarImage src="/avatar-placeholder.png" alt={stylist.name} />
                  <AvatarFallback className="bg-gray-200 text-gray-700 text-xs font-medium">
                    {stylist.initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-gray-700">{stylist.name}</span>
              </div>
              <span className="text-base font-semibold text-gray-900">{stylist.bookings}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
