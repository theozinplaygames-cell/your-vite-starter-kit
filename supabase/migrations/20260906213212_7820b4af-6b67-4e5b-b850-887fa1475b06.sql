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

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.duels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  is_public BOOLEAN NOT NULL DEFAULT true,
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  countries TEXT[] NOT NULL DEFAULT '{}',
  current_round INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'waiting',
  winner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX duels_waiting_idx ON public.duels (status, is_public, created_at);
GRANT SELECT, INSERT, UPDATE ON public.duels TO authenticated;
GRANT ALL ON public.duels TO service_role;
ALTER TABLE public.duels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "duels_select_players_or_open" ON public.duels FOR SELECT TO authenticated
  USING (auth.uid() = host_id OR auth.uid() = guest_id OR (status = 'waiting' AND is_public));
CREATE POLICY "duels_insert_host" ON public.duels FOR INSERT TO authenticated WITH CHECK (auth.uid() = host_id);
CREATE POLICY "duels_update_players" ON public.duels FOR UPDATE TO authenticated
  USING (auth.uid() = host_id OR auth.uid() = guest_id)
  WITH CHECK (auth.uid() = host_id OR auth.uid() = guest_id);

CREATE OR REPLACE FUNCTION public.is_duel_player(_duel_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.duels d
    WHERE d.id = _duel_id AND (d.host_id = _user_id OR d.guest_id = _user_id)
  );
$$;

CREATE TABLE public.duel_guesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_id UUID NOT NULL REFERENCES public.duels(id) ON DELETE CASCADE,
  round INT NOT NULL,
  player_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  country_id TEXT NOT NULL,
  correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (duel_id, round, player_id)
);
GRANT SELECT, INSERT ON public.duel_guesses TO authenticated;
GRANT ALL ON public.duel_guesses TO service_role;
ALTER TABLE public.duel_guesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "duel_guesses_select_players" ON public.duel_guesses FOR SELECT TO authenticated
  USING (public.is_duel_player(duel_id, auth.uid()));
CREATE POLICY "duel_guesses_insert_own" ON public.duel_guesses FOR INSERT TO authenticated
  WITH CHECK (player_id = auth.uid() AND public.is_duel_player(duel_id, auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.duels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.duel_guesses;
ALTER TABLE public.duels REPLICA IDENTITY FULL;
ALTER TABLE public.duel_guesses REPLICA IDENTITY FULL;