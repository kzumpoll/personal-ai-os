import { format } from 'date-fns';
import pool, { Journal, Win, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';

// pg may return DATE columns as Date objects or strings. Extract YYYY-MM-DD safely.
function toDateStr(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

async function getData() {
  try {
    const [journalsRes, winsRes] = await Promise.all([
      pool.query<Journal>('SELECT * FROM journals ORDER BY entry_date DESC LIMIT 30'),
      pool.query<Win>('SELECT * FROM wins ORDER BY entry_date DESC, created_at DESC'),
    ]);
    const winsByDate = winsRes.rows.reduce<Record<string, Win[]>>((acc, w) => {
      const key = toDateStr(w.entry_date);
      acc[key] = acc[key] ?? [];
      acc[key].push(w);
      return acc;
    }, {});
    return { journals: journalsRes.rows, winsByDate };
  } catch (err) {
    logDbError('journal', err);
    return { journals: [] as Journal[], winsByDate: {} as Record<string, Win[]> };
  }
}

export const revalidate = 30;

export default async function JournalPage() {
  const { journals, winsByDate } = await getData();

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Journal" subtitle={`${journals.length} entries`} />

      {journals.length === 0 ? (
        <p className="text-sm text-[#555]">
          No journal entries yet. Run daily debrief in Telegram.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {journals.map((j) => {
            const entryStr = toDateStr(j.entry_date);
            const wins = winsByDate[entryStr] ?? (j.wins_json ?? []).map((w, i) => ({ id: String(i), content: w }));
            return (
              <div
                key={j.id}
                className="rounded-lg p-5"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <h2 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>
                  {format(new Date(entryStr + 'T12:00:00'), 'MMMM d, yyyy')}
                </h2>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  {j.mit && (
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>MIT</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{j.mit}</p>
                    </div>
                  )}
                  {j.p1 && (
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>P1</p>
                      <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{j.p1}</p>
                    </div>
                  )}
                  {j.p2 && (
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>P2</p>
                      <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{j.p2}</p>
                    </div>
                  )}
                </div>

                {j.open_journal && (
                  <p className="text-sm pt-4 mb-4 leading-relaxed" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    {j.open_journal}
                  </p>
                )}

                {wins.length > 0 && (
                  <div className="pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Wins</p>
                    <ul className="flex flex-col gap-1">
                      {wins.map((w, i) => (
                        <li key={'id' in w ? w.id : i} className="text-xs flex gap-2" style={{ color: 'var(--text-dim)' }}>
                          <span style={{ color: 'var(--green)' }}>+</span>
                          {'content' in w ? w.content : String(w)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
