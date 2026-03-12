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
import TaskDetailPanel from './TaskDetailPanel';

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'day2' | 'next7';

interface Props {
  board: Record<Bucket, Task[]>;
  todayStr: string;
  tomorrowStr: string;
  day2Str: string;
  day2Label: string;
}

function DroppableColumn({ bucket, label, tasks, color, isDragging, onSelectTask }: { bucket: Bucket; label: string; tasks: Task[]; color: string; isDragging: boolean; onSelectTask?: (task: Task) => void }) {
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
        <span style={{ fontFamily: "var(--font-mono)", fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color, fontWeight: 600 }}>
          {label}
        </span>
        <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', fontFamily: "var(--font-mono)", fontSize: '10px' }}>
          {tasks.length}
        </span>
      </div>
      {tasks.length === 0 ? (
        <div className="text-xs py-4 text-center" style={{ color: 'var(--text-faint)' }}>—</div>
      ) : (
        tasks.map((task) => <DraggableCard key={task.id} task={task} bucket={bucket} onSelect={onSelectTask} />)
      )}
    </div>
  );
}

function DraggableCard({ task, bucket, onSelect }: { task: Task; bucket: Bucket; onSelect?: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task, sourceBucket: bucket },
  });

  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.3 : 1, cursor: 'grab' }} {...listeners} {...attributes}>
      <TaskCard task={task} bucket={bucket} onSelect={onSelect} />
    </div>
  );
}

export default function TaskBoard({ board: initialBoard, todayStr, tomorrowStr, day2Str, day2Label }: Props) {
  const router = useRouter();
  const [board, setBoard] = useState(initialBoard);
  const [activeTask, setActiveTask] = useState<{ task: Task; sourceBucket: Bucket } | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => { setBoard(initialBoard); }, [initialBoard]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const bucketMeta: Record<Bucket, { label: string; color: string; date: string | null }> = {
    overdue:  { label: 'Overdue',       color: 'var(--red)',        date: null },
    today:    { label: 'Today',         color: 'var(--amber)',      date: todayStr },
    tomorrow: { label: 'Tomorrow',      color: 'var(--green)',      date: tomorrowStr },
    day2:     { label: day2Label,        color: 'var(--cyan)',       date: day2Str },
    next7:    { label: 'Next 7 Days',   color: 'var(--blue)',       date: null },
  };

  function bucketToDate(bucket: Bucket): string | null {
    if (bucket === 'overdue') return null;
    if (bucket === 'today') return todayStr;
    if (bucket === 'tomorrow') return tomorrowStr;
    if (bucket === 'day2') return day2Str;
    // next7: drop into +4 days from today
    const base = new Date(todayStr + 'T12:00:00');
    base.setDate(base.getDate() + 4);
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

    setBoard((prev) => {
      const next = { ...prev };
      next[sourceBucket] = prev[sourceBucket].filter((t) => t.id !== task.id);
      next[target] = [...prev[target], { ...task, due_date: newDate }];
      return next;
    });

    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, due_date: newDate }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      console.error('[TaskBoard] move failed, reverting', err);
      setBoard(initialBoard);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBoard, todayStr, tomorrowStr, day2Str]);

  // Build visible buckets — hide overdue when empty
  const buckets: Bucket[] = board.overdue.length > 0
    ? ['overdue', 'today', 'tomorrow', 'day2', 'next7']
    : ['today', 'tomorrow', 'day2', 'next7'];

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div>
        <div className="flex justify-end mb-4">
          <TaskQuickAdd />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" style={board.overdue.length > 0 ? { gridTemplateColumns: undefined } : undefined}>
          <style>{board.overdue.length > 0 ? `@media (min-width: 1280px) { .task-grid { grid-template-columns: repeat(5, 1fr) !important; } }` : ''}</style>
          {buckets.map((bucket) => {
            const meta = bucketMeta[bucket];
            return (
              <DroppableColumn
                key={bucket}
                bucket={bucket}
                label={meta.label}
                tasks={board[bucket]}
                color={meta.color}
                isDragging={activeTask !== null}
                onSelectTask={setSelectedTask}
              />
            );
          })}
        </div>
      </div>
      <DragOverlay>
        {activeTask && (
          <div style={{ opacity: 0.85, pointerEvents: 'none' }}>
            <TaskCard task={activeTask.task} bucket={activeTask.sourceBucket} />
          </div>
        )}
      </DragOverlay>
      {selectedTask && (
        <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
    </DndContext>
  );
}
