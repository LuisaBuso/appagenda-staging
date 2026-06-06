import { Sidebar } from '../../../components/Layout/Sidebar';
import { KPIMetrics } from '../../../components/Perfomance/kpi-metrics';
import { TopStylists } from '../../../components/Perfomance/top-stylists';
import { TopServices } from '../../../components/Perfomance/top-services';

export default function Performance() {
  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-12">
          {/* Title */}
          <h1 className="text-2xl font-semibold text-gray-900 mb-6">Today's KPIs</h1>

          {/* Main layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* KPIs */}
            <div className="lg:col-span-1">
              <KPIMetrics />
            </div>

            {/* Top stylists + Top services */}
            <div className="lg:col-span-2 space-y-6">
              <TopStylists />
              <TopServices />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}