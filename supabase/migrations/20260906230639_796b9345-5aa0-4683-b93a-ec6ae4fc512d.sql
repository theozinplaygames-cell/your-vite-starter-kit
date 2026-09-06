CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'username', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
      split_part(COALESCE(NEW.email, 'jogador'), '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.duels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  is_public BOOLEAN NOT NULL DEFAULT true,
  mode TEXT NOT NULL DEFAULT 'duel',
  max_players INT NOT NULL DEFAULT 2,
  duration_seconds INT NOT NULL DEFAULT 60,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  countries TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'waiting',
  started_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  winner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX duels_waiting_idx ON public.duels (status, is_public, mode, created_at);
GRANT SELECT ON public.duels TO authenticated;
GRANT ALL ON public.duels TO service_role;
ALTER TABLE public.duels ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.duel_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_id UUID NOT NULL REFERENCES public.duels(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (duel_id, player_id)
);
CREATE INDEX duel_players_duel_idx ON public.duel_players (duel_id);
GRANT SELECT ON public.duel_players TO authenticated;
GRANT ALL ON public.duel_players TO service_role;
ALTER TABLE public.duel_players ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_duel_player(_duel_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.duel_players p
    WHERE p.duel_id = _duel_id AND p.player_id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION public.is_duel_player(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_duel_player(UUID, UUID) TO authenticated, service_role;

CREATE POLICY "duels_select_players_or_open" ON public.duels FOR SELECT TO authenticated
  USING (
    auth.uid() = host_id
    OR public.is_duel_player(id, auth.uid())
    OR (status = 'waiting' AND is_public)
  );

CREATE POLICY "duel_players_select_participants" ON public.duel_players FOR SELECT TO authenticated
  USING (
    player_id = auth.uid()
    OR public.is_duel_player(duel_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.duels d
      WHERE d.id = duel_id AND d.status = 'waiting' AND d.is_public
    )
  );

CREATE TABLE public.duel_guesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_id UUID NOT NULL REFERENCES public.duels(id) ON DELETE CASCADE,
  idx INT NOT NULL,
  player_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  country_id TEXT NOT NULL,
  correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (duel_id, idx, player_id)
);
CREATE INDEX duel_guesses_duel_idx ON public.duel_guesses (duel_id);
GRANT SELECT ON public.duel_guesses TO authenticated;
GRANT ALL ON public.duel_guesses TO service_role;
ALTER TABLE public.duel_guesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "duel_guesses_select_players" ON public.duel_guesses FOR SELECT TO authenticated
  USING (public.is_duel_player(duel_id, auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.duels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.duel_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.duel_guesses;
ALTER TABLE public.duels REPLICA IDENTITY FULL;
ALTER TABLE public.duel_players REPLICA IDENTITY FULL;
ALTER TABLE public.duel_guesses REPLICA IDENTITY FULL;