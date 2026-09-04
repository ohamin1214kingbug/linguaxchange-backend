-- Refines search_users_fuzzy from add_user_search_fuzzy.sql. Run after it;
-- a fresh database needs both, in that order.
--
-- The first version scored a name only as "first last" concatenated, which
-- meant a typo in one half was measured against the whole string. "Ohh"
-- found nobody: against "Hamin Oh" it scores below any usable threshold,
-- even though against "Oh" alone it scores 0.40. Every surname typo failed
-- the same way.
--
-- GREATEST of the three comparisons fixes that — full name, first name, and
-- last name each get scored, and the best one wins. Verified against
-- production after the change: "Ohh" now reaches both Hamins at 0.40.
--
-- Same signature as before, so nothing calling it needed to change.
--
-- p_threshold's default stays 0.25 and is effectively dead: the application
-- passes 0.15 explicitly (see FUZZY_THRESHOLD in utils/userSearch.js, which
-- carries the measurement behind that number). The default is left where it
-- is rather than lowered here, so the value the app uses has exactly one
-- home and this file cannot quietly disagree with it.
CREATE OR REPLACE FUNCTION search_users_fuzzy(
  p_query     text,
  p_limit     int  DEFAULT 20,
  p_threshold real DEFAULT 0.25
)
RETURNS TABLE (
  id int, first_name text, last_name text, photo_url text,
  nationality text, teach_language text, teach_level text, score real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT u.id, u.first_name, u.last_name, u.photo_url,
         u.nationality, u.teach_language, u.teach_level,
         GREATEST(
           similarity(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), p_query),
           similarity(coalesce(u.first_name, ''), p_query),
           similarity(coalesce(u.last_name, ''), p_query)
         ) AS score
  FROM users u
  WHERE u.deleted_at IS NULL
    AND GREATEST(
          similarity(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), p_query),
          similarity(coalesce(u.first_name, ''), p_query),
          similarity(coalesce(u.last_name, ''), p_query)
        ) > p_threshold
  ORDER BY score DESC, u.first_name
  LIMIT p_limit;
$$;
