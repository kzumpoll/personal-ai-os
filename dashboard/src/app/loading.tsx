/**
 * Next.js App Router loading UI — shown immediately on navigation
 * while the server component fetches data. Makes day-to-day navigation
 * feel instant because the skeleton renders before any DB queries run.
 */
export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto" style={{ opacity: 0.45 }}>
      {/* Header skeleton */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="h-7 w-28 rounded mb-2" style={{ background: 'var(--surface)' }} />
          <div className="h-3 w-44 rounded" style={{ background: 'var(--surface)' }} />
        </div>
        <div className="flex gap-2 mt-1">
          <div className="h-7 w-14 rounded" style={{ background: 'var(--surface)' }} />
          <div className="h-7 w-16 rounded" style={{ background: 'var(--surface)' }} />
          <div className="h-7 w-14 rounded" style={{ background: 'var(--surface)' }} />
        </div>
      </div>

      {/* Focus block skeleton */}
      <div
        className="mb-8 rounded-lg p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--border)', height: 90 }}
      />

      {/* Task grid skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-3 w-20 rounded" style={{ background: 'var(--surface)', marginBottom: 4 }} />
            {[1, 2, 3].map((j) => (
              <div key={j} className="h-10 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
