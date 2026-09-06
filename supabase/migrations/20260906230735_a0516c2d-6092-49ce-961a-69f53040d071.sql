DROP TABLE IF EXISTS public.duel_players;
DROP POLICY IF EXISTS "duels_select_players_or_open" ON public.duels;
DROP POLICY IF EXISTS "duel_guesses_select_players" ON public.duel_guesses;
DROP FUNCTION IF EXISTS public.is_duel_player(UUID, UUID);

ALTER TABLE public.duels ADD COLUMN IF NOT EXISTS player_ids UUID[] NOT NULL DEFAULT '{}';

CREATE POLICY "duels_select_players_or_open" ON public.duels FOR SELECT TO authenticated
  USING (
    auth.uid() = host_id
    OR auth.uid() = ANY (player_ids)
    OR (status = 'waiting' AND is_public)
  );

CREATE POLICY "duel_guesses_select_players" ON public.duel_guesses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.duels d
      WHERE d.id = duel_id
        AND (d.host_id = auth.uid() OR auth.uid() = ANY (d.player_ids))
    )
  );

CREATE OR REPLACE FUNCTION public.join_duel(_duel_id UUID, _user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.duels%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.duels WHERE id = _duel_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF _user_id = ANY (d.player_ids) THEN RETURN 'ok'; END IF;
  IF d.status <> 'waiting' THEN RETURN 'started'; END IF;
  IF cardinality(d.player_ids) >= d.max_players THEN RETURN 'full'; END IF;

  UPDATE public.duels
  SET player_ids = array_append(player_ids, _user_id),
      updated_at = now()
  WHERE id = _duel_id;

  SELECT * INTO d FROM public.duels WHERE id = _duel_id;
  IF cardinality(d.player_ids) >= d.max_players THEN
    UPDATE public.duels
    SET status = 'playing',
        started_at = now(),
        ends_at = now() + make_interval(secs => d.duration_seconds),
        updated_at = now()
    WHERE id = _duel_id AND status = 'waiting';
  END IF;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.join_duel(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_duel(UUID, UUID) TO service_role;