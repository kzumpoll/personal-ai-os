'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { Task } from '@/lib/db';
import TaskCard from './TaskCard';
import TaskQuickAdd from './TaskQuickAdd';

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'next7' | 'future';

const bucketMeta: Record<Bucket, { label: string; color: string }> = {
  overdue:  { label: 'Overdue',     color: 'var(--red)' },
  today:    { label: 'Today',       color: 'var(--amber)' },
  tomorrow: { label: 'Tomorrow',    color: 'var(--green)' },
  next7:    { label: 'Next 7 Days', color: 'var(--blue)' },
  future:   { label: 'Future',      color: 'var(--text-muted)' },
};

interface Props {
  board: Record<Bucket, Task[]>;
  todayStr: string;
  tomorrowStr: string;
}

function DroppableColumn({ bucket, tasks, isDragging }: { bucket: Bucket; tasks: Task[]; isDragging: boolean }) {
  const { label, color } = bucketMeta[bucket];
  const { setNodeRef, isOver } = useDroppable({ id: bucket });

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col gap-2"
      style={{
        minHeight: isDragging ? 80 : undefined,
        background: isOver ? 'rgba(255,255,255,0.03)' : undefined,
        borderRadius: 8,
        transition: 'background 0.15s',
        padding: isOver ? '0 4px' : undefined,
      }}
    >
      <div
        className="flex items-center justify-between mb-1 pb-2"
        style={{ borderBottom: `1px solid ${isOver ? color : 'var(--border)'}`, transition: 'border-color 0.15s' }}
      >
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color, fontWeight: 600 }}>
          {label}
        </span>
        <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '10px' }}>
          {tasks.length}
        </span>
      </div>
      {tasks.length === 0 ? (
        <div className="text-xs py-4 text-center" style={{ color: 'var(--text-faint)' }}>—</div>
      ) : (
        tasks.map((task) => <DraggableCard key={task.id} task={task} bucket={bucket} />)
      )}
    </div>
  );
}

function DraggableCard({ task, bucket }: { task: Task; bucket: Bucket }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task, sourceBucket: bucket },
  });

  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.3 : 1, cursor: 'grab' }} {...listeners} {...attributes}>
      <TaskCard task={task} bucket={bucket} />
    </div>
  );
}

export default function TaskBoard({ board: initialBoard, todayStr, tomorrowStr }: Props) {
  const router = useRouter();
  const [board, setBoard] = useState(initialBoard);
  const [activeTask, setActiveTask] = useState<{ task: Task; sourceBucket: Bucket } | null>(null);

  // Sync local board state when server sends fresh data (after router.refresh())
  useEffect(() => { setBoard(initialBoard); }, [initialBoard]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function bucketToDate(bucket: Bucket): string | null {
    if (bucket === 'overdue') return null;
    if (bucket === 'today') return todayStr;
    if (bucket === 'tomorrow') return tomorrowStr;
    const base = new Date(todayStr + 'T12:00:00');
    base.setDate(base.getDate() + (bucket === 'next7' ? 3 : 10));
    return base.toISOString().slice(0, 10);
  }

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveTask(event.active.data.current as { task: Task; sourceBucket: Bucket });
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveTask(null);
    const { over, active } = event;
    if (!over) return;
    const target = over.id as Bucket;
    const { task, sourceBucket } = active.data.current as { task: Task; sourceBucket: Bucket };
    if (target === sourceBucket) return;
    const newDate = bucketToDate(target);
    if (!newDate) return;

    // Optimistic update
    setBoard((prev) => {
      const next = { ...prev };
      next[sourceBucket] = prev[sourceBucket].filter((t) => t.id !== task.id);
      next[target] = [...prev[target], { ...task, due_date: newDate }];
      return next;
    });

    const payload = { id: task.id, due_date: newDate };
    console.log('[TaskBoard] PATCH payload', payload);
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      console.log('[TaskBoard] PATCH response', res.status, data);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
      router.refresh();
    } catch (err) {
      console.error('[TaskBoard] move failed, reverting', err);
      setBoard(initialBoard); // revert
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBoard, todayStr, tomorrowStr]);

  // Hide overdue column when empty — no reason to show an empty column
  const buckets: Bucket[] = (
    board.overdue.length > 0
      ? ['overdue', 'today', 'tomorrow', 'next7', 'future']
      : ['today', 'tomorrow', 'next7', 'future']
  ) as Bucket[];

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div>
        <div className="flex justify-end mb-4">
          <TaskQuickAdd />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {buckets.map((bucket) => (
            <DroppableColumn key={bucket} bucket={bucket} tasks={board[bucket]} isDragging={activeTask !== null} />
          ))}
        </div>
      </div>
      <DragOverlay>
        {activeTask && (
          <div style={{ opacity: 0.85, pointerEvents: 'none' }}>
            <TaskCard task={activeTask.task} bucket={activeTask.sourceBucket} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
