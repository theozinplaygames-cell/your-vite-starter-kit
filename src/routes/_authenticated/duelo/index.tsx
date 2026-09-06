import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createPrivateRoom, joinByCode, quickMatch } from "@/lib/duel.functions";

export const Route = createFileRoute("/_authenticated/duelo/")({
  head: () => ({
    meta: [
      { title: "Duelo 1x1 — Atlas Quiz" },
      {
        name: "description",
        content:
          "Entre na fila pública ou crie uma sala com código e dispute 5 países contra outro jogador.",
      },
      { property: "og:title", content: "Duelo 1x1 — Atlas Quiz" },
      {
        property: "og:description",
        content: "Melhor de 5 países contra outro jogador, ao vivo no mapa-múndi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Lobby,
});

function Lobby() {
  const navigate = useNavigate();
  const quick = useServerFn(quickMatch);
  const create = useServerFn(createPrivateRoom);
  const join = useServerFn(joinByCode);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ duelId: string }>) => {
    setError(null);
    setBusy(key);
    try {
      const { duelId } = await fn();
      navigate({ to: "/duelo/$id", params: { id: duelId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo deu errado.");
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-5 px-4 py-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <Link to="/" className="text-xs uppercase tracking-[0.35em] text-accent">
            ← Modo solo
          </Link>
          <h1 className="font-display mt-2 text-3xl font-bold">Duelo 1x1</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Melhor de 5 países. Quem acertar mais, vence.
          </p>
        </div>
        <button onClick={signOut} className="text-sm text-muted-foreground hover:text-foreground">
          Sair
        </button>
      </header>

      {error && <p className="text-sm text-wrong">{error}</p>}

      <div className="panel flex flex-col gap-3 p-5">
        <button
          onClick={() => run("quick", () => quick())}
          disabled={busy !== null}
          className="font-display w-full rounded-xl bg-primary px-4 py-4 text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === "quick" ? "Procurando..." : "Jogar agora (fila pública)"}
        </button>
        <p className="text-xs text-muted-foreground">
          Você entra na sala de quem já está esperando — ou abre uma e aguarda alguém.
        </p>
      </div>

      <div className="panel flex flex-col gap-3 p-5">
        <p className="font-display text-sm font-semibold">Jogar com um amigo</p>
        <button
          onClick={() => run("create", () => create())}
          disabled={busy !== null}
          className="w-full rounded-xl border border-accent/60 px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
        >
          {busy === "create" ? "Criando..." : "Criar sala com código"}
        </button>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("join", () => join({ data: { code } }));
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CÓDIGO"
            maxLength={8}
            className="input-field flex-1 tracking-[0.3em]"
          />
          <button
            type="submit"
            disabled={busy !== null || code.length < 4}
            className="rounded-xl bg-secondary px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  );
}
