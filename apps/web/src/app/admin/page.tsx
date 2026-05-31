'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Loader2 } from 'lucide-react';
import type { AnalyticsSummary } from '@reader/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const RANGES = [7, 30, 90] as const;

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function DailyChart({ daily }: { daily: AnalyticsSummary['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.translate + d.discuss + d.upload));
  return (
    <div className="flex h-48 items-end gap-0.5">
      {daily.map((d) => {
        const total = d.translate + d.discuss + d.upload;
        const h = (total / max) * 100;
        return (
          <div
            key={d.date}
            className="group relative flex-1"
            style={{ height: '100%' }}
            title={`${d.date}: ${total} events (translate ${d.translate}, discuss ${d.discuss}, upload ${d.upload})`}
          >
            <div
              className="absolute bottom-0 w-full overflow-hidden rounded-sm"
              style={{ height: `${h}%` }}
            >
              <div
                className="bg-primary/30"
                style={{ height: `${(d.upload / Math.max(total, 1)) * 100}%` }}
              />
              <div
                className="bg-primary/60"
                style={{ height: `${(d.discuss / Math.max(total, 1)) * 100}%` }}
              />
              <div
                className="bg-primary"
                style={{ height: `${(d.translate / Math.max(total, 1)) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarList({ rows }: { rows: { label: string; count: number }[] }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  }
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 truncate capitalize text-muted-foreground">{r.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right tabular-nums">{r.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const [days, setDays] = useState<number>(30);
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api.getAnalytics(days),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <BarChart3 className="h-6 w-6" />
            <span className="text-xl font-semibold tracking-tight">Analytics</span>
          </div>
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <Button
                key={r}
                variant={days === r ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setDays(r)}
              >
                {r}d
              </Button>
            ))}
            <Button asChild variant="ghost" size="sm">
              <Link href="/library">
                <ArrowLeft className="mr-1 h-4 w-4" /> Library
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container space-y-6 py-8">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error || !data ? (
          <div className="rounded-xl border border-dashed py-20 text-center text-muted-foreground">
            Failed to load analytics. Admin access required.
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Total users" value={data.totals.users} />
              <StatCard label="Total books" value={data.totals.books} />
              <StatCard label={`Signups (${data.rangeDays}d)`} value={data.window.signups} />
              <StatCard
                label={`Active users (${data.rangeDays}d)`}
                value={data.window.activeUsers}
              />
              <StatCard label={`Events (${data.rangeDays}d)`} value={data.window.events} />
              <StatCard label="Cached translations" value={data.totals.translationsCached} />
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Daily activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DailyChart daily={data.daily} />
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-3 rounded-sm bg-primary" /> Translate
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-3 rounded-sm bg-primary/60" /> Discuss
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-3 rounded-sm bg-primary/30" /> Upload
                  </span>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Events by type</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList
                    rows={data.eventsByType.map((e) => ({ label: e.type, count: e.count }))}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Top AI providers</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList
                    rows={data.topProviders.map((p) => ({ label: p.provider, count: p.count }))}
                  />
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
