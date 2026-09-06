CREATE OR REPLACE FUNCTION public.is_duel_player(_duel_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.duels d
    WHERE d.id = _duel_id AND (d.host_id = _user_id OR d.guest_id = _user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;