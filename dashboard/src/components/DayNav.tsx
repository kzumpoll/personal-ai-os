'use client';

import { useRouter } from 'next/navigation';
import { format, addDays, subDays } from 'date-fns';

interface Props {
  currentDate: string; // YYYY-MM-DD
}

export default function DayNav({ currentDate }: Props) {
  const router = useRouter();
  const d = new Date(currentDate + 'T12:00:00');
  const today = format(new Date(), 'yyyy-MM-dd');
  const isToday = currentDate === today;

  const go = (date: string) => {
    if (date === today) {
      router.push('/');
    } else {
      router.push(`/?date=${date}`);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => go(format(subDays(d, 1), 'yyyy-MM-dd'))}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 13,
          cursor: 'pointer',
          lineHeight: 1.4,
        }}
      >
        ← Prev
      </button>

      {!isToday && (
        <button
          onClick={() => go(today)}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--cyan)',
            color: 'var(--cyan)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            cursor: 'pointer',
            lineHeight: 1.4,
            fontFamily: "var(--font-mono)",
            letterSpacing: '0.06em',
          }}
        >
          TODAY
        </button>
      )}

      <button
        onClick={() => go(format(addDays(d, 1), 'yyyy-MM-dd'))}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 13,
          cursor: 'pointer',
          lineHeight: 1.4,
        }}
      >
        Next →
      </button>
    </div>
  );
}
