import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DURATION_SECONDS, makeCode, pickCountries } from "./duel.server";

export type DuelMode = "duel" | "ffa";

const MAX_PLAYERS: Record<DuelMode, number> = { duel: 2, ffa: 10 };

function parseMode(value: unknown): DuelMode {
  return value === "ffa" ? "ffa" : "duel";
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function createDuel(hostId: string, mode: DuelMode, isPublic: boolean) {
  const db = await admin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await db
      .from("duels")
      .insert({
        code: makeCode(),
        is_public: isPublic,
        mode,
        max_players: MAX_PLAYERS[mode],
        duration_seconds: DURATION_SECONDS,
        host_id: hostId,
        player_ids: [hostId],
        countries: pickCountries(),
        status: "waiting",
      })
      .select("id, code")
      .single();
    if (!error && data) return data;
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  }
  throw new Error("Não foi possível criar a sala. Tente novamente.");
}

async function joinDuel(duelId: string, userId: string) {
  const db = await admin();
  const { data, error } = await db.rpc("join_duel", { _duel_id: duelId, _user_id: userId });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Entra numa sala pública em espera ou cria uma nova. */
export const quickMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { mode?: string }) => ({ mode: parseMode(data?.mode) }))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const userId = context.userId;
    const mode = data.mode;

    // Reaproveita uma partida em andamento do próprio jogador.
    const { data: mine } = await db
      .from("duels")
      .select("id")
      .in("status", ["waiting", "playing"])
      .eq("mode", mode)
      .contains("player_ids", [userId])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mine) return { duelId: mine.id };

    const { data: open } = await db
      .from("duels")
      .select("id, player_ids, max_players")
      .eq("status", "waiting")
      .eq("is_public", true)
      .eq("mode", mode)
      .order("created_at", { ascending: true })
      .limit(10);

    for (const room of open ?? []) {
      if (room.player_ids.length >= room.max_players) continue;
      const result = await joinDuel(room.id, userId);
      if (result === "ok") return { duelId: room.id };
    }

    const created = await createDuel(userId, mode, true);
    return { duelId: created.id };
  });

/** Cria uma sala privada com código para convidar amigos. */
export const createPrivateRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { mode?: string }) => ({ mode: parseMode(data?.mode) }))
  .handler(async ({ data, context }) => {
    const created = await createDuel(context.userId, data.mode, false);
    return { duelId: created.id, code: created.code };
  });

/** Entra numa sala pelo código. */
export const joinByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => ({
    code: String(data.code ?? "")
      .trim()
      .toUpperCase()
      .slice(0, 8),
  }))
  .handler(async ({ data, context }) => {
    if (data.code.length < 4) throw new Error("Código inválido.");
    const db = await admin();
    const { data: duel } = await db
      .from("duels")
      .select("id")
      .eq("code", data.code)
      .maybeSingle();
    if (!duel) throw new Error("Sala não encontrada.");

    const result = await joinDuel(duel.id, context.userId);
    if (result === "full") throw new Error("Essa sala já está cheia.");
    if (result === "started") throw new Error("Essa partida já começou.");
    if (result !== "ok") throw new Error("Não foi possível entrar na sala.");
    return { duelId: duel.id };
  });

/** O anfitrião começa a partida antes da sala encher. */
export const startDuel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { duelId: string }) => ({ duelId: String(data.duelId) }))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: duel } = await db
      .from("duels")
      .select("id, host_id, status, player_ids, duration_seconds")
      .eq("id", data.duelId)
      .maybeSingle();
    if (!duel) throw new Error("Sala não encontrada.");
    if (duel.host_id !== context.userId) throw new Error("Só o anfitrião pode começar.");
    if (duel.status !== "waiting") return { ok: true };
    if (duel.player_ids.length < 2) throw new Error("Espere pelo menos mais um jogador.");

    const now = Date.now();
    await db
      .from("duels")
      .update({
        status: "playing",
        started_at: new Date(now).toISOString(),
        ends_at: new Date(now + duel.duration_seconds * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", duel.id)
      .eq("status", "waiting");
    return { ok: true };
  });

/** Sai de uma sala que ainda está esperando jogadores. */
export const cancelDuel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { duelId: string }) => ({ duelId: String(data.duelId) }))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await db
      .from("duels")
      .delete()
      .eq("id", data.duelId)
      .eq("host_id", context.userId)
      .eq("status", "waiting");
    return { ok: true };
  });

/** Fecha a partida quando o tempo acaba e define o vencedor. */
export const finishDuel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { duelId: string }) => ({ duelId: String(data.duelId) }))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: duel } = await db
      .from("duels")
      .select("id, status, ends_at, player_ids")
      .eq("id", data.duelId)
      .maybeSingle();
    if (!duel) throw new Error("Partida não encontrada.");
    if (!duel.player_ids.includes(context.userId)) throw new Error("Você não está nesta partida.");
    if (duel.status !== "playing") return { ok: true };
    if (!duel.ends_at || new Date(duel.ends_at).getTime() > Date.now()) {
      return { ok: false };
    }

    const { data: all } = await db
      .from("duel_guesses")
      .select("player_id, correct")
      .eq("duel_id", duel.id);

    const scores = new Map<string, number>();
    for (const pid of duel.player_ids) scores.set(pid, 0);
    for (const g of all ?? []) {
      if (g.correct) scores.set(g.player_id, (scores.get(g.player_id) ?? 0) + 1);
    }
    let best = -1;
    let winner: string | null = null;
    let tie = false;
    for (const [pid, value] of scores) {
      if (value > best) {
        best = value;
        winner = pid;
        tie = false;
      } else if (value === best) {
        tie = true;
      }
    }

    await db
      .from("duels")
      .update({
        status: "finished",
        winner_id: tie ? null : winner,
        updated_at: new Date().toISOString(),
      })
      .eq("id", duel.id)
      .eq("status", "playing");
    return { ok: true };
  });

/** Registra o palpite do jogador na pergunta atual dele. */
export const submitGuess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { duelId: string; idx: number; countryId: string }) => ({
    duelId: String(data.duelId),
    idx: Number(data.idx),
    countryId: String(data.countryId),
  }))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const userId = context.userId;

    const { data: duel, error } = await db
      .from("duels")
      .select("id, player_ids, countries, status, ends_at")
      .eq("id", data.duelId)
      .maybeSingle();
    if (error || !duel) throw new Error("Partida não encontrada.");
    if (!duel.player_ids.includes(userId)) throw new Error("Você não está nesta partida.");
    if (duel.status !== "playing") throw new Error("A partida não está em andamento.");
    if (duel.ends_at && new Date(duel.ends_at).getTime() < Date.now()) {
      throw new Error("O tempo acabou.");
    }

    const answer = duel.countries[data.idx];
    if (!answer) throw new Error("Pergunta inválida.");
    const correct = answer === data.countryId;

    await db.from("duel_guesses").upsert(
      {
        duel_id: duel.id,
        idx: data.idx,
        player_id: userId,
        country_id: data.countryId,
        correct,
      },
      { onConflict: "duel_id,idx,player_id", ignoreDuplicates: true },
    );

    return { correct, answer };
  });
