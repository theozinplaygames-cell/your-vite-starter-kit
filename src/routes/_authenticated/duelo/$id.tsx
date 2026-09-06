import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { WorldMap } from "@/components/WorldMap";
import { countryById } from "@/lib/geo";
import { supabase } from "@/integrations/supabase/client";
import { cancelDuel, finishDuel, startDuel, submitGuess } from "@/lib/duel.functions";

export const Route = createFileRoute("/_authenticated/duelo/$id")({
  head: () => ({
    meta: [
      { title: "Partida ao vivo — Atlas Quiz" },
      {
        name: "description",
        content: "1 minuto no relógio: encontre o máximo de países no mapa antes dos adversários.",
      },
      { property: "og:title", content: "Partida ao vivo — Atlas Quiz" },
      {
        property: "og:description",
        content: "Corrida de 1 minuto no mapa-múndi contra até 9 adversários.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DuelPage,
});

type Duel = {
  id: string;
  code: string;
  host_id: string;
  mode: string;
  max_players: number;
  player_ids: string[];
  countries: string[];
  status: string;
  ends_at: string | null;
  winner_id: string | null;
};

type Guess = { idx: number; player_id: string; correct: boolean };

function DuelPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const guessFn = useServerFn(submitGuess);
  const cancelFn = useServerFn(cancelDuel);
  const startFn = useServerFn(startDuel);
  const finishFn = useServerFn(finishDuel);

  const [me, setMe] = useState<string | null>(null);
  const [duel, setDuel] = useState<Duel | null>(null);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; answer: string } | null>(null);
  const [myCount, setMyCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const finishing = useRef(false);

  const loadDuel = useCallback(async () => {
    const { data } = await supabase
      .from("duels")
      .select("id, code, host_id, mode, max_players, player_ids, countries, status, ends_at, winner_id")
      .eq("id", id)
      .maybeSingle();
    if (data) setDuel(data);
  }, [id]);

  const loadGuesses = useCallback(async () => {
    const { data } = await supabase
      .from("duel_guesses")
      .select("idx, player_id, correct")
      .eq("duel_id", id);
    if (data) setGuesses(data);
  }, [id]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    void loadDuel();
    void loadGuesses();
    const channel = supabase
      .channel(`duel-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "duels", filter: `id=eq.${id}` },
        () => void loadDuel(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "duel_guesses", filter: `duel_id=eq.${id}` },
        () => void loadGuesses(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, loadDuel, loadGuesses]);

  // Relógio da partida.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Fallback do tempo real enquanto a sala espera jogadores.
  useEffect(() => {
    if (!duel || duel.status !== "waiting") return;
    const t = setInterval(() => void loadDuel(), 2500);
    return () => clearInterval(t);
  }, [duel, loadDuel]);

  useEffect(() => {
    const ids = duel?.player_ids ?? [];
    if (!ids.length) return;
    supabase
      .from("profiles")
      .select("id, username")
      .in("id", ids)
      .then(({ data }) => {
        if (!data) return;
        setNames(Object.fromEntries(data.map((p) => [p.id, p.username])));
      });
  }, [duel]);

  // Sincroniza o contador local com o servidor.
  useEffect(() => {
    if (!me) return;
    const mine = guesses.filter((g) => g.player_id === me).length;
    setMyCount((c) => Math.max(c, mine));
  }, [guesses, me]);

  const remaining = duel?.ends_at
    ? Math.max(0, Math.ceil((new Date(duel.ends_at).getTime() - now) / 1000))
    : null;

  // Encerra a partida assim que o tempo zera.
  useEffect(() => {
    if (!duel || duel.status !== "playing" || remaining === null || remaining > 0) return;
    if (finishing.current) return;
    finishing.current = true;
    void finishFn({ data: { duelId: duel.id } })
      .then(() => loadDuel())
      .finally(() => {
        finishing.current = false;
      });
  }, [duel, remaining, finishFn, loadDuel]);

  const scores = useMemo(() => {
    const map = new Map<string, number>();
    for (const pid of duel?.player_ids ?? []) map.set(pid, 0);
    for (const g of guesses) if (g.correct) map.set(g.player_id, (map.get(g.player_id) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [guesses, duel]);

  const finished = duel?.status === "finished";
  const playing = duel?.status === "playing" && (remaining ?? 0) > 0;
  const target = duel && playing ? countryById.get(duel.countries[myCount] ?? "") : undefined;

  const send = async () => {
    if (!selected || !duel || busy || feedback) return;
    setBusy(true);
    setError(null);
    const idx = myCount;
    try {
      const res = await guessFn({ data: { duelId: duel.id, idx, countryId: selected } });
      setFeedback({ correct: res.correct, answer: res.answer });
      setTimeout(() => {
        setFeedback(null);
        setSelected(null);
        setMyCount((c) => Math.max(c, idx + 1));
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  };

  if (!duel) {
    return (
      <main className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando partida...
      </main>
    );
  }

  const isHost = duel.host_id === me;
  const modeLabel = duel.mode === "ffa" ? "Todos contra todos" : "Duelo 1x1";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-6 md:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/duelo" className="text-xs uppercase tracking-[0.35em] text-accent">
            ← Salas
          </Link>
          <h1 className="font-display mt-1 text-3xl font-bold">{modeLabel}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="panel px-5 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Tempo</p>
            <p
              className={`font-display text-2xl font-bold ${
                (remaining ?? 60) <= 10 ? "text-wrong" : ""
              }`}
            >
              {remaining === null ? "1:00" : `0:${String(remaining).padStart(2, "0")}`}
            </p>
          </div>
          <div className="panel px-5 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Seus acertos
            </p>
            <p className="font-display text-2xl font-bold">
              {me ? (scores.find(([pid]) => pid === me)?.[1] ?? 0) : 0}
            </p>
          </div>
        </div>
      </header>

      {duel.status === "waiting" ? (
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-display text-2xl font-bold">
            Esperando jogadores… ({duel.player_ids.length}/{duel.max_players})
          </p>
          <p className="text-sm text-muted-foreground">Código da sala:</p>
          <p className="font-display text-4xl font-bold tracking-[0.4em] text-accent">
            {duel.code}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {duel.player_ids.map((pid) => (
              <span
                key={pid}
                className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-sm"
              >
                {names[pid] ?? "Jogador"}
              </span>
            ))}
          </div>
          {isHost && duel.player_ids.length >= 2 && (
            <button
              onClick={async () => {
                try {
                  await startFn({ data: { duelId: duel.id } });
                  await loadDuel();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Não foi possível começar.");
                }
              }}
              className="font-display mt-3 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
            >
              Começar agora
            </button>
          )}
          <button
            onClick={async () => {
              await cancelFn({ data: { duelId: duel.id } });
              navigate({ to: "/duelo" });
            }}
            className="mt-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Sair da sala
          </button>
          {error && <p className="text-sm text-wrong">{error}</p>}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <section className="panel overflow-hidden p-2">
            <WorldMap
              selected={selected}
              onSelect={(cid) => {
                if (playing && !feedback) setSelected(cid);
              }}
              disabled={!playing || Boolean(feedback)}
              correctId={feedback ? feedback.answer : null}
              wrongId={feedback && !feedback.correct ? selected : null}
              resetKey={myCount}
            />
          </section>

          <aside className="flex flex-col gap-4">
            <div className="panel p-5">
              {finished || !playing ? (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Fim da partida
                  </p>
                  <p className="font-display mt-1 text-2xl font-bold text-primary">
                    {duel.winner_id === null
                      ? "Empate!"
                      : duel.winner_id === me
                        ? "Você venceu!"
                        : `${names[duel.winner_id] ?? "Adversário"} venceu`}
                  </p>
                  <Link
                    to="/duelo"
                    className="font-display mt-4 block w-full rounded-xl bg-primary px-4 py-3 text-center font-semibold text-primary-foreground"
                  >
                    Jogar de novo
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Encontre no mapa
                  </p>
                  <p className="font-display mt-1 text-2xl font-bold text-primary">
                    {target?.name ?? "..."}
                  </p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {feedback
                      ? feedback.correct
                        ? "Acertou!"
                        : `Era ${countryById.get(feedback.answer)?.name ?? "outro país"}`
                      : selected
                        ? "País selecionado. Confirme."
                        : "Clique em um país no mapa."}
                  </p>
                  <button
                    onClick={send}
                    disabled={!selected || busy || Boolean(feedback)}
                    className="font-display mt-4 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Enviar palpite
                  </button>
                </>
              )}
              {error && <p className="mt-3 text-sm text-wrong">{error}</p>}
            </div>

            <div className="panel p-5">
              <p className="font-display text-sm font-semibold">Placar ao vivo</p>
              <div className="mt-3 flex flex-col gap-2">
                {scores.map(([pid, value], i) => (
                  <div
                    key={pid}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                      pid === me ? "border-accent/60 bg-accent/10" : "border-border bg-secondary/40"
                    }`}
                  >
                    <span className="truncate">
                      {i + 1}. {names[pid] ?? "Jogador"}
                      {pid === me ? " (você)" : ""}
                    </span>
                    <span className="font-display font-bold">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
