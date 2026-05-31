'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import type { AnalyticsSummary } from '@reader/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const RANGES = [7, 30, 90] as const;
const USERS_PAGE_SIZE = 25;
const FEEDBACK_PAGE_SIZE = 25;
const FEEDBACK_STATUSES = ['open', 'all', 'resolved'] as const;

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function FeedbackPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof FEEDBACK_STATUSES)[number]>('open');
  const [page, setPage] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-feedback', status, page],
    queryFn: () => api.getFeedback(status, FEEDBACK_PAGE_SIZE, page * FEEDBACK_PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      api.setFeedbackResolved(id, resolved),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-feedback'] }),
  });

  const total = data?.total ?? 0;
  const to = Math.min((page + 1) * FEEDBACK_PAGE_SIZE, total);
  const hasPrev = page > 0;
  const hasNext = to < total;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>
          Feedback{' '}
          {data && data.unresolved > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
              {data.unresolved} open
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-1">
          {FEEDBACK_STATUSES.map((s) => (
            <Button
              key={s}
              variant={status === s ? 'default' : 'ghost'}
              size="sm"
              className="capitalize"
              onClick={() => {
                setStatus(s);
                setPage(0);
              }}
            >
              {s}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Failed to load feedback.</p>
        ) : data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No feedback here.</p>
        ) : (
          <div className="space-y-3">
            {data.items.map((f) => (
              <div
                key={f.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{f.email}</span>
                    <span>{fmtDateTime(f.createdAt)}</span>
                    {f.resolved && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                        resolved
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{f.message}</p>
                </div>
                <Button
                  variant={f.resolved ? 'ghost' : 'outline'}
                  size="sm"
                  className="shrink-0"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: f.id, resolved: !f.resolved })}
                >
                  {f.resolved ? (
                    <>
                      <RotateCcw className="mr-1 h-4 w-4" /> Reopen
                    </>
                  ) : (
                    <>
                      <Check className="mr-1 h-4 w-4" /> Resolve
                    </>
                  )}
                </Button>
              </div>
            ))}

            {(hasPrev || hasNext) && (
              <div className="flex items-center justify-end gap-2 pt-1 text-sm text-muted-foreground">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!hasPrev}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!hasNext}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function MethodBadge({ method }: { method: 'google' | 'email' }) {
  return (
    <span className="rounded-full border px-2 py-0.5 text-xs capitalize text-muted-foreground">
      {method}
    </span>
  );
}

function UsersTable() {
  const [page, setPage] = useState(0);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-users', page],
    queryFn: () => api.getUsers(USERS_PAGE_SIZE, page * USERS_PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : page * USERS_PAGE_SIZE + 1;
  const to = Math.min((page + 1) * USERS_PAGE_SIZE, total);
  const hasPrev = page > 0;
  const hasNext = to < total;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>
          Users {total > 0 && <span className="text-muted-foreground">({total})</span>}
        </CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {total > 0 && (
            <span>
              {from}–{to}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            disabled={!hasPrev}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Failed to load users.</p>
        ) : data.users.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Email</th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Signup</th>
                  <th className="px-2 py-2 font-medium">Joined</th>
                  <th className="px-2 py-2 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-2 py-2">{u.email}</td>
                    <td className="px-2 py-2 text-muted-foreground">{u.name ?? '—'}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {u.signupMethods.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          u.signupMethods.map((m) => <MethodBadge key={m} method={m} />)
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{fmtDate(u.createdAt)}</td>
                    <td className="px-2 py-2 text-muted-foreground">{fmtDate(u.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

            <FeedbackPanel />
            <UsersTable />
          </>
        )}
      </main>
    </div>
  );
}
