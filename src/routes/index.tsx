import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { WorldMap } from "@/components/WorldMap";
import { supabase } from "@/integrations/supabase/client";
import {
  countryById,
  idsInRegion,
  idsInSubregion,
  quizPool,
  type CountryMeta,
} from "@/lib/geo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atlas Quiz — Adivinhe onde fica cada país no mapa" },
      {
        name: "description",
        content:
          "Jogo de geografia: encontre o país sorteado no mapa-múndi. Use dicas de continente, região e idioma — quanto menos dicas, mais pontos.",
      },
      { property: "og:title", content: "Atlas Quiz — Adivinhe onde fica cada país" },
      {
        property: "og:description",
        content:
          "Clique no país certo no mapa-múndi, use até 3 dicas e some o máximo de pontos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Game,
});

const POINTS = [100, 70, 40, 20];

function pick(exclude?: string): CountryMeta {
  let c = quizPool[Math.floor(Math.random() * quizPool.length)]!;
  while (c.id === exclude) c = quizPool[Math.floor(Math.random() * quizPool.length)]!;
  return c;
}

type Result = { ok: boolean; guessId: string } | null;

function Game() {
  const [target, setTarget] = useState<CountryMeta | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hints, setHints] = useState(0);
  const [result, setResult] = useState<Result>(null);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [streak, setStreak] = useState(0);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setTarget(pick());
  }, []);

  const next = useCallback(() => {
    setTarget((t) => pick(t?.id));
    setSelected(null);
    setHints(0);
    setResult(null);
    setRound((r) => r + 1);
  }, []);

  const check = () => {
    if (!target || !selected || result) return;
    const ok = selected === target.id;
    setResult({ ok, guessId: selected });
    if (ok) {
      setScore((s) => s + POINTS[hints]!);
      setStreak((s) => s + 1);
    } else {
      setStreak(0);
    }
  };

  const hintList = target
    ? [
        { label: "Continente", value: target.region },
        { label: "Região", value: target.subregion },
        {
          label: "Idioma",
          value: target.languages.length ? target.languages.join(", ") : "Sem idioma oficial",
        },
      ]
    : [];



  const outlineIds =
    target && hints >= 2
      ? idsInSubregion(target.subregion)
      : target && hints >= 1
        ? idsInRegion(target.region)
        : [];


  const finished = result !== null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-6 md:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-xs uppercase tracking-[0.35em] text-accent">
            Atlas Quiz
          </p>
          <h1 className="font-display text-3xl font-bold md:text-4xl">
            Onde fica esse país?
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to={signedIn ? "/duelo" : "/auth"}
            className="font-display rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {signedIn ? "Duelo 1x1" : "Entrar para duelar"}
          </Link>
          <Stat label="Pontos" value={score} />
          <Stat label="Rodada" value={round} />
          <Stat label="Sequência" value={streak} />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="panel overflow-hidden p-2">
          <WorldMap
            selected={selected}
            onSelect={(id) => {
              if (!finished) setSelected(id);
            }}
            disabled={finished}
            correctId={finished ? (target?.id ?? null) : null}
            wrongId={result && !result.ok ? result.guessId : null}
            highlightIds={outlineIds}

            resetKey={round}
          />
        </section>

        <aside className="flex flex-col gap-4">
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Encontre no mapa
            </p>
            <p className="font-display mt-1 text-2xl font-bold text-primary">
              {target?.name ?? "..."}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {finished
                ? result?.ok
                  ? `Acertou! +${POINTS[hints]!} pontos.`
                  : `Errou. O país estava marcado em verde.`
                : selected
                  ? "País selecionado. Confirme sua resposta."
                  : "Clique em um país no mapa."}
            </p>
            <button
              onClick={finished ? next : check}
              disabled={!finished && !selected}
              className="font-display mt-4 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {finished ? "Próximo país" : "Checar"}
            </button>
            {finished && (
              <div
                className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
                  result?.ok
                    ? "border-correct/50 text-correct"
                    : "border-wrong/50 text-wrong"
                }`}
              >
                {result?.ok
                  ? "Resposta correta"
                  : `Você marcou ${countryById.get(result!.guessId)?.name ?? "outro país"}`}
              </div>
            )}
          </div>

          <div className="panel p-5">
            <div className="flex items-center justify-between">
              <p className="font-display text-sm font-semibold">Dicas</p>
              <p className="text-xs text-muted-foreground">
                Valem {POINTS[hints]!} pts
              </p>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {hintList.map((h, i) => (
                <div
                  key={h.label}
                  className="rounded-xl border border-border bg-secondary/40 px-3 py-2"
                >
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    {h.label}
                  </p>
                  {i < hints ? (
                    <p className="text-sm font-medium text-accent">{h.value}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground/60">••••••</p>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setHints((h) => Math.min(3, h + 1))}
              disabled={hints >= 3 || finished}
              className="mt-3 w-full rounded-xl border border-accent/60 px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {hints >= 3 ? "Sem mais dicas" : `Revelar dica ${hints + 1} de 3`}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel px-4 py-2 text-center">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-display text-xl font-bold">{value}</p>
    </div>
  );
}
