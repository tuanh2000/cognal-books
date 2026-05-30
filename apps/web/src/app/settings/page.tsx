'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { AI_PROVIDERS, AI_PROVIDER_INFO, type AiProvider } from '@reader/shared';
import { api, ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const [provider, setProvider] = useState<AiProvider>(AI_PROVIDERS[0]);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: keys, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: api.listApiKeys,
  });

  const add = useMutation({
    mutationFn: () =>
      api.addApiKey({ provider, apiKey: apiKey.trim(), model: model.trim() || undefined }),
    onSuccess: () => {
      setApiKey('');
      setModel('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to add key'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const info = AI_PROVIDER_INFO[provider];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label="Back to library">
              <Link href="/library">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <span className="text-xl font-semibold tracking-tight">Settings</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container max-w-2xl py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" /> Add an AI API key
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose a platform first, then paste an API key for it. You can add several keys for
              the same platform — they&apos;re rotated automatically to spread usage across multiple
              free-tier keys. Keys are encrypted before they are stored.
            </p>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (apiKey.trim()) add.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="provider">Platform</Label>
                <select
                  id="provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as AiProvider)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {AI_PROVIDER_INFO[p].label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="apiKey">API key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={info.keyPlaceholder}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Get one from{' '}
                  <a
                    href={info.consoleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {info.label}
                  </a>
                  .
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="model">
                  Model <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="model"
                  placeholder={info.defaultModel}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={!apiKey.trim() || add.isPending}>
                {add.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add key
              </Button>
            </form>
          </CardContent>
        </Card>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your API keys
          </h2>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : keys && keys.length > 0 ? (
            <ul className="space-y-2">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between rounded-lg border bg-card p-4"
                >
                  <div>
                    <p className="font-medium">
                      {AI_PROVIDER_INFO[k.provider]?.label ?? k.provider}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {k.maskedKey}
                      {k.model ? ` · ${k.model}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove key"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(k.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">
              <p>No API keys yet. Add one above to use your own provider for translation.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
