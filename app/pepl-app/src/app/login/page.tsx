'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

type Mode = 'magic' | 'password' | 'signup';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('magic');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'info' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: displayName ? { display_name: displayName } : undefined,
          },
        });
        if (error) throw error;
        setMsg({ kind: 'info', text: 'Check your email for the magic link.' });
      } else if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/dashboard');
        router.refresh();
      } else {
        // signup
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: { display_name: displayName || email.split('@')[0] },
          },
        });
        if (error) throw error;
        setMsg({
          kind: 'info',
          text: 'Account created. Check your email to confirm, then sign in.',
        });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm border border-stone-300 bg-white p-6">
        <div className="mb-6">
          <div className="font-mono text-xs font-bold tracking-wider mb-1">PEPL</div>
          <div className="font-mono text-[10px] text-stone-500">private_event_prediction_league</div>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-4 border-b border-stone-200">
          {(['magic', 'password', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setMsg(null); }}
              className={`px-3 py-2 font-mono text-[10px] uppercase tracking-wider border-b-2 -mb-px ${
                mode === m
                  ? 'border-stone-900 text-stone-900'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              }`}
            >
              {m === 'magic' ? 'Magic Link' : m === 'password' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="font-mono text-[10px] uppercase text-stone-500 block mb-1">
              email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-stone-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-stone-900"
              autoComplete="email"
            />
          </div>

          {(mode === 'password' || mode === 'signup') && (
            <div>
              <label className="font-mono text-[10px] uppercase text-stone-500 block mb-1">
                password {mode === 'signup' && '(min 8 chars)'}
              </label>
              <input
                type="password"
                required
                minLength={mode === 'signup' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-stone-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-stone-900"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </div>
          )}

          {(mode === 'magic' || mode === 'signup') && (
            <div>
              <label className="font-mono text-[10px] uppercase text-stone-500 block mb-1">
                display_name {mode === 'magic' && '(only used on first sign-in)'}
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Alex"
                className="w-full border border-stone-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-stone-900"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full bg-stone-900 text-white py-2 font-mono text-xs uppercase tracking-wider disabled:bg-stone-300"
          >
            {loading
              ? '...'
              : mode === 'magic'
              ? 'Send magic link'
              : mode === 'password'
              ? 'Sign in'
              : 'Create account'}
          </button>

          {msg && (
            <div
              className={`text-xs p-2 border ${
                msg.kind === 'err'
                  ? 'bg-rose-50 border-rose-300 text-rose-800'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-800'
              }`}
            >
              {msg.text}
            </div>
          )}
        </form>

        <div className="mt-6 pt-4 border-t border-stone-200 font-mono text-[10px] text-stone-400">
          mode: <span className="text-stone-600">{mode}</span>
          {' · '}
          supports: magic-link, email/password
        </div>
      </div>
    </div>
  );
}
