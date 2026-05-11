'use client';

export function DashboardHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center">
      <h1 className="text-4xl font-bold">{title}</h1>
    </div>
  );
}
