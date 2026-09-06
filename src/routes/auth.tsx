import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar no Atlas Quiz — duelos 1x1 de geografia" },
      {
        name: "description",
        content:
          "Crie sua conta ou entre para desafiar outros jogadores em duelos 1x1 de geografia no mapa-múndi.",
      },
      { property: "og:title", content: "Entrar no Atlas Quiz" },
      {
        property: "og:description",
        content: "Conta gratuita para jogar duelos 1x1 de geografia contra outros jogadores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "code">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [verifyType, setVerifyType] = useState<"signup" | "email">("signup");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") navigate({ to: "/", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/auth",
            data: { username: username.trim() || email.split("@")[0] },
          },
        });
        if (err) throw err;
        if (data.session) {
          navigate({ to: "/", replace: true });
        } else {
          setVerifyType("signup");
          setAwaitingCode(true);
          setMessage("Enviamos um código de 6 dígitos para o seu e-mail.");
        }
      } else if (mode === "code") {
        const { error: err } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });
        if (err) throw err;
        setVerifyType("email");
        setAwaitingCode(true);
        setMessage("Enviamos um código de 6 dígitos para o seu e-mail.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate({ to: "/", replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: verifyType,
      });
      if (err) throw err;
      navigate({ to: "/", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código inválido ou expirado.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (verifyType === "signup") {
        const { error: err } = await supabase.auth.resend({ type: "signup", email });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });
        if (err) throw err;
      }
      setMessage("Enviamos um novo código para o seu e-mail.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reenviar o código.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth",
    });
    if (result.error) {
      setError("Não foi possível entrar com o Google.");
      return;
    }
    // O listener acima navega quando a sessão estiver pronta.
  };

  if (awaitingCode) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 px-4 py-10">
        <div>
          <button
            type="button"
            onClick={() => {
              setAwaitingCode(false);
              setCode("");
              setError(null);
              setMessage(null);
            }}
            className="text-xs uppercase tracking-[0.35em] text-accent"
          >
            ← Voltar
          </button>
          <h1 className="font-display mt-2 text-3xl font-bold">Confirme seu e-mail</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Digite o código de 6 dígitos enviado para <strong>{email}</strong>.
          </p>
        </div>

        <form onSubmit={verify} className="panel flex flex-col gap-4 p-6">
          <Field label="Código de verificação">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="input-field text-center text-2xl font-semibold tracking-[0.6em]"
            />
          </Field>

          {error && <p className="text-sm font-medium text-wrong">{error}</p>}
          {message && <p className="text-sm font-medium text-correct">{message}</p>}

          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="font-display w-full rounded-xl bg-primary px-4 py-3.5 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Verificando..." : "Confirmar código"}
          </button>

          <button
            type="button"
            onClick={resend}
            disabled={busy}
            className="text-sm text-accent underline-offset-4 hover:underline disabled:opacity-50"
          >
            Reenviar código
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 px-4 py-10">
      <div>
        <Link to="/" className="text-xs uppercase tracking-[0.35em] text-accent">
          ← Atlas Quiz
        </Link>
        <h1 className="font-display mt-2 text-3xl font-bold">
          {mode === "signin" ? "Entrar" : mode === "code" ? "Entrar com código" : "Criar conta"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "code"
            ? "Receba um código de 6 dígitos no seu e-mail, sem senha."
            : "Sua conta guarda seu apelido e libera os duelos 1x1."}
        </p>
      </div>

      <form onSubmit={submit} className="panel flex flex-col gap-4 p-6">
        {mode === "signup" && (
          <Field label="Apelido">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={20}
              placeholder="Como quer aparecer no duelo"
              className="input-field"
            />
          </Field>
        )}
        <Field label="E-mail">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
          />
        </Field>
        {mode !== "code" && (
          <Field label="Senha">
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="Mínimo de 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
            />
          </Field>
        )}

        {error && <p className="text-sm font-medium text-wrong">{error}</p>}
        {message && <p className="text-sm font-medium text-correct">{message}</p>}

        <button
          type="submit"
          disabled={busy}
          className="font-display w-full rounded-xl bg-primary px-4 py-3.5 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? "Aguarde..."
            : mode === "signin"
              ? "Entrar"
              : mode === "code"
                ? "Enviar código"
                : "Criar conta"}
        </button>

        <button
          type="button"
          onClick={google}
          className="w-full rounded-xl border-2 border-border px-4 py-3 text-sm font-semibold transition-colors hover:bg-accent/10"
        >
          Continuar com o Google
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "code" ? "signin" : "code");
            setError(null);
            setMessage(null);
          }}
          className="text-sm text-accent underline-offset-4 hover:underline"
        >
          {mode === "code" ? "Entrar com senha" : "Entrar com código (sem senha)"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
            setMessage(null);
          }}
          className="text-sm text-accent underline-offset-4 hover:underline"
        >
          {mode === "signup" ? "Já tenho conta" : "Não tem conta? Criar agora"}
        </button>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-widest text-foreground/80">
        {label}
      </span>
      {children}
    </label>
  );
}

