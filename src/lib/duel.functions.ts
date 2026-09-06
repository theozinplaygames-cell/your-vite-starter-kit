import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { makeCode, pickCountries, ROUNDS } from "./duel.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function createDuel(hostId: string, isPublic: boolean) {
  const db = await admin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await db
      .from("duels")
      .insert({
        code: makeCode(),
        is_public: isPublic,
        host_id: hostId,
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

/** Entra numa sala pública em espera ou cria uma nova. */
export const quickMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const userId = context.userId;

    // Reaproveita um duelo em andamento do próprio jogador.
    const { data: mine } = await db
      .from("duels")
      .select("id")
      .in("status", ["waiting", "playing"])
      .or(`host_id.eq.${userId},guest_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mine) return { duelId: mine.id as string };

    const { data: open } = await db
      .from("duels")
      .select("id")
      .eq("status", "waiting")
      .eq("is_public", true)
      .neq("host_id", userId)
      .is("guest_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (open) {
      const { data: joined } = await db
        .from("duels")
        .update({ guest_id: userId, status: "playing", updated_at: new Date().toISOString() })
        .eq("id", open.id)
        .is("guest_id", null)
        .select("id")
        .maybeSingle();
      if (joined) return { duelId: joined.id as string };
    }

    const created = await createDuel(userId, true);
    return { duelId: created.id as string };
  });

/** Cria uma sala privada com código para convidar um amigo. */
export const createPrivateRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const created = await createDuel(context.userId, false);
    return { duelId: created.id as string, code: created.code as string };
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
      .select("id, host_id, guest_id, status")
      .eq("code", data.code)
      .maybeSingle();
    if (!duel) throw new Error("Sala não encontrada.");
    if (duel.host_id === context.userId || duel.guest_id === context.userId) {
      return { duelId: duel.id as string };
    }
    if (duel.guest_id || duel.status !== "waiting") throw new Error("Essa sala já está cheia.");

    const { data: joined } = await db
      .from("duels")
      .update({
        guest_id: context.userId,
        status: "playing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", duel.id)
      .is("guest_id", null)
      .select("id")
      .maybeSingle();
    if (!joined) throw new Error("Essa sala já está cheia.");
    return { duelId: joined.id as string };
  });

/** Sai de uma sala que ainda está esperando adversário. */
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

/** Registra o palpite da rodada e avança o duelo quando os dois responderam. */
export const submitGuess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { duelId: string; countryId: string }) => ({
    duelId: String(data.duelId),
    countryId: String(data.countryId),
  }))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const userId = context.userId;

    const { data: duel, error } = await db
      .from("duels")
      .select("id, host_id, guest_id, countries, current_round, status")
      .eq("id", data.duelId)
      .maybeSingle();
    if (error || !duel) throw new Error("Duelo não encontrado.");
    if (duel.host_id !== userId && duel.guest_id !== userId) throw new Error("Você não está neste duelo.");
    if (duel.status !== "playing") throw new Error("O duelo não está em andamento.");

    const round = duel.current_round as number;
    const answer = (duel.countries as string[])[round - 1];
    const correct = answer === data.countryId;

    await db
      .from("duel_guesses")
      .upsert(
        {
          duel_id: duel.id,
          round,
          player_id: userId,
          country_id: data.countryId,
          correct,
        },
        { onConflict: "duel_id,round,player_id", ignoreDuplicates: true },
      );

    const { data: roundGuesses } = await db
      .from("duel_guesses")
      .select("player_id")
      .eq("duel_id", duel.id)
      .eq("round", round);

    if ((roundGuesses?.length ?? 0) >= 2) {
      if (round >= ROUNDS) {
        const { data: all } = await db
          .from("duel_guesses")
          .select("player_id, correct")
          .eq("duel_id", duel.id);
        const score = (id: string | null) =>
          (all ?? []).filter((g) => g.player_id === id && g.correct).length;
        const hostScore = score(duel.host_id as string);
        const guestScore = score(duel.guest_id as string | null);
        const winner =
          hostScore === guestScore
            ? null
            : hostScore > guestScore
              ? (duel.host_id as string)
              : (duel.guest_id as string | null);
        await db
          .from("duels")
          .update({ status: "finished", winner_id: winner, updated_at: new Date().toISOString() })
          .eq("id", duel.id);
      } else {
        await db
          .from("duels")
          .update({ current_round: round + 1, updated_at: new Date().toISOString() })
          .eq("id", duel.id);
      }
    }

    return { correct, answer };
  });
