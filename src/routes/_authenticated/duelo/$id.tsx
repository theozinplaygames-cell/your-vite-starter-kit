import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { WorldMap } from "@/components/WorldMap";
import { countryById } from "@/lib/geo";
import { supabase } from "@/integrations/supabase/client";
import { cancelDuel, submitGuess } from "@/lib/duel.functions";

export const Route = createFileRoute("/_authenticated/duelo/$id")({
  head: () => ({
    meta: [
      { title: "Partida 1x1 — Atlas Quiz" },
      {
        name: "description",
        content: "Duelo ao vivo: 5 países, dois jogadores, um mapa-múndi.",
      },
      { property: "og:title", content: "Partida 1x1 — Atlas Quiz" },
      { property: "og:description", content: "Duelo ao vivo de geografia no mapa-múndi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DuelPage,
});

const ROUNDS = 5;

type Duel = {
  id: string;
  code: string;
  host_id: string;
  guest_id: string | null;
  countries: string[];
  current_round: number;
  status: string;
  winner_id: string | null;
};

type Guess = {
  round: number;
  player_id: string;
  country_id: string;
  correct: boolean;
};

function DuelPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const guessFn = useServerFn(submitGuess);
  const cancelFn = useServerFn(cancelDuel);

  const [me, setMe] = useState<string | null>(null);
  const [duel, setDuel] = useState<Duel | null>(null);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDuel = useCallback(async () => {
    const { data } = await supabase.from("duels").select("*").eq("id", id).maybeSingle();
    if (data) setDuel(data as Duel);
  }, [id]);

  const loadGuesses = useCallback(async () => {
    const { data } = await supabase
      .from("duel_guesses")
      .select("round, player_id, country_id, correct")
      .eq("duel_id", id);
    if (data) setGuesses(data as Guess[]);
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

  // Enquanto espera adversário, confere periodicamente (fallback do tempo real).
  useEffect(() => {
    if (!duel || duel.status !== "waiting") return;
    const t = setInterval(() => void loadDuel(), 3000);
    return () => clearInterval(t);
  }, [duel, loadDuel]);

  useEffect(() => {
    const ids = duel ? [duel.host_id, duel.guest_id].filter(Boolean) as string[] : [];
    if (!ids.length) return;
    supabase
      .from("profiles")
      .select("id, username")
      .in("id", ids)
      .then(({ data }) => {
        if (!data) return;
        setNames(Object.fromEntries(data.map((p) => [p.id as string, p.username as string])));
      });
  }, [duel]);

  const round = duel?.current_round ?? 1;
  const myGuess = useMemo(
    () => guesses.find((g) => g.round === round && g.player_id === me) ?? null,
    [guesses, round, me],
  );
  const opponentId = duel ? (duel.host_id === me ? duel.guest_id : duel.host_id) : null;
  const scoreOf = (pid: string | null) =>
    pid ? guesses.filter((g) => g.player_id === pid && g.correct).length : 0;

  const finished = duel?.status === "finished";
  const lastFinishedRound = finished ? ROUNDS : round - 1;
  const revealRound = myGuess && !finished ? round : lastFinishedRound;
  const revealAnswer = duel && revealRound >= 1 ? duel.countries[revealRound - 1] : undefined;
  const revealGuesses = guesses.filter((g) => g.round === revealRound);
  const bothAnswered = revealGuesses.length >= 2;

  const target = duel && !finished ? countryById.get(duel.countries[round - 1] ?? "") : undefined;

  const send = async () => {
    if (!selected || !duel) return;
    setBusy(true);
    setError(null);
    try {
      await guessFn({ data: { duelId: duel.id, countryId: selected } });
      await loadGuesses();
      await loadDuel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setSelected(null);
  }, [round]);

  if (!duel) {
    return (
      <main className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando duelo...
      </main>
    );
  }

  const waiting = duel.status === "waiting";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-6 md:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/duelo" className="text-xs uppercase tracking-[0.35em] text-accent">
            ← Duelos
          </Link>
          <h1 className="font-display mt-1 text-3xl font-bold">Duelo 1x1</h1>
        </div>
        <div className="flex gap-3">
          <Stat label={names[duel.host_id] ?? "Anfitrião"} value={scoreOf(duel.host_id)} />
          <Stat
            label={duel.guest_id ? (names[duel.guest_id] ?? "Adversário") : "Aguardando"}
            value={scoreOf(duel.guest_id)}
          />
          <Stat label="Rodada" value={Math.min(round, ROUNDS)} />
        </div>
      </header>

      {waiting ? (
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-display text-2xl font-bold">Esperando um adversário…</p>
          <p className="text-sm text-muted-foreground">
            Compartilhe o código da sala para alguém entrar:
          </p>
          <p className="font-display text-4xl font-bold tracking-[0.4em] text-accent">
            {duel.code}
          </p>
          <button
            onClick={async () => {
              await cancelFn({ data: { duelId: duel.id } });
              navigate({ to: "/duelo" });
            }}
            className="mt-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancelar sala
          </button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <section className="panel overflow-hidden p-2">
            <WorldMap
              selected={selected}
              onSelect={(cid) => {
                if (!myGuess && !finished) setSelected(cid);
              }}
              disabled={Boolean(myGuess) || finished}
              correctId={bothAnswered ? (revealAnswer ?? null) : null}
              wrongId={
                bothAnswered && myGuess && !myGuess.correct ? myGuess.country_id : null
              }
              resetKey={round}
            />
          </section>

          <aside className="flex flex-col gap-4">
            <div className="panel p-5">
              {finished ? (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Fim do duelo
                  </p>
                  <p className="font-display mt-1 text-2xl font-bold text-primary">
                    {duel.winner_id === null
                      ? "Empate!"
                      : duel.winner_id === me
                        ? "Você venceu!"
                        : "Você perdeu"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {scoreOf(duel.host_id)} × {scoreOf(duel.guest_id)}
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
                    Rodada {round} de {ROUNDS} — encontre no mapa
                  </p>
                  <p className="font-display mt-1 text-2xl font-bold text-primary">
                    {target?.name ?? "..."}
                  </p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {myGuess
                      ? "Palpite enviado. Esperando o adversário…"
                      : selected
                        ? "País selecionado. Confirme sua resposta."
                        : "Clique em um país no mapa."}
                  </p>
                  <button
                    onClick={send}
                    disabled={!selected || Boolean(myGuess) || busy}
                    className="font-display mt-4 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {myGuess ? "Aguardando…" : "Enviar palpite"}
                  </button>
                </>
              )}
              {error && <p className="mt-3 text-sm text-wrong">{error}</p>}
            </div>

            <div className="panel p-5">
              <p className="font-display text-sm font-semibold">Rodadas</p>
              <div className="mt-3 flex flex-col gap-2">
                {Array.from({ length: ROUNDS }, (_, i) => i + 1).map((r) => {
                  const answer = duel.countries[r - 1];
                  const mine = guesses.find((g) => g.round === r && g.player_id === me);
                  const theirs = guesses.find((g) => g.round === r && g.player_id === opponentId);
                  const done = Boolean(mine && theirs);
                  return (
                    <div
                      key={r}
                      className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {r}. {done ? (countryById.get(answer ?? "")?.name ?? "—") : "•••"}
                      </span>
                      <span className="flex gap-2">
                        <Dot ok={mine?.correct} shown={done} />
                        <Dot ok={theirs?.correct} shown={done} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function Dot({ ok, shown }: { ok?: boolean | undefined; shown: boolean }) {
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${
        !shown ? "bg-muted-foreground/30" : ok ? "bg-correct" : "bg-wrong"
      }`}
    />
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel px-4 py-2 text-center">
      <p className="max-w-[110px] truncate text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="font-display text-xl font-bold">{value}</p>
    </div>
  );
}
