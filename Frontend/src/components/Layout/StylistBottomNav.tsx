"use client";

import React from "react";
import { BarChart3, CalendarDays, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";

type StylistTab = "agenda" | "reports" | "profile";

type NavItem = {
  key: StylistTab;
  label: string;
  icon: React.ReactNode;
  path: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    key: "agenda",
    label: "Agenda",
    icon: <CalendarDays className="h-5 w-5" />,
    path: "/stylist/appointments",
  },
  {
    key: "reports",
    label: "Reportes",
    icon: <BarChart3 className="h-5 w-5" />,
    path: "/stylist/reports",
  },
  {
    key: "profile",
    label: "Perfil",
    icon: <UserRound className="h-5 w-5" />,
    path: "/stylist/profile",
  },
];

interface StylistBottomNavProps {
  active?: StylistTab;
}

export function StylistBottomNav({ active }: StylistBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const resolvedActive =
    active ||
    (NAV_ITEMS.find((item) => location.pathname.startsWith(item.path))?.key ??
      ("agenda" as StylistTab));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[480px] items-center justify-between px-8 py-3">
        {NAV_ITEMS.map((item) => {
          const isActive = resolvedActive === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-col items-center gap-1 text-xs font-semibold transition-colors",
                isActive ? "text-gray-900" : "text-gray-500"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border",
                  isActive
                    ? "border-gray-900 bg-gray-900 text-white shadow-sm"
                    : "border-gray-200 bg-white text-gray-700"
                )}
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default StylistBottomNav;
