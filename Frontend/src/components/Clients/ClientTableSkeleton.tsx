import { Skeleton } from "../ui/skeleton"

interface ClientTableSkeletonProps {
  rows?: number
  columns?: number
}

export function ClientTableSkeleton({ rows = 8, columns = 4 }: ClientTableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-gray-100 last:border-b-0">
          {/* Name cell with avatar */}
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
              </div>
            </div>
          </td>
          {/* Remaining cells */}
          {Array.from({ length: columns - 1 }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <Skeleton className="h-3.5 w-24" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
