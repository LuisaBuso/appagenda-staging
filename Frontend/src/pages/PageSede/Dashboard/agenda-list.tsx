import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"

const agendas = [
  { name: "Paulina", time: "10:00-11:00", status: "Confirmada" },
  { name: "Sofia", time: "11:00-12:00", status: "" },
  { name: "Celia", time: "12:00-13:00", status: "" },
  { name: "Pedro", time: "13:00-14:00", status: "" },
]

export function AgendaList() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Agendas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {agendas.map((agenda, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
                  <div className="h-2 w-2 rounded-full bg-purple-600" />
                </div>
                <span className="font-medium">{agenda.name}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">{agenda.time}</div>
                {agenda.status && <div className="text-xs text-gray-500">{agenda.status}</div>}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
