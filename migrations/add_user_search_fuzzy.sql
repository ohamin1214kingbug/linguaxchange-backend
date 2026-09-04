-- Typo tolerance for the people search.
--
-- pg_trgm compares strings by their three-character slices, so "Hamn" and
-- "Hamin" score high without anyone writing an edit-distance function in
-- application code.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The index is on the same expression the function ranks by, or the planner
-- cannot use it.
CREATE INDEX IF NOT EXISTS users_full_name_trgm
  ON users USING gin ((trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) gin_trgm_ops);

-- Called only when the exact search found nothing, so this never changes a
-- result that already worked — it turns a dead end into the nearest names.
--
-- Matches on the full name rather than either column, which also makes word
-- order stop mattering: "박 경훈" and "경훈 박" share their trigrams.
--
-- p_threshold is a knob on purpose. 0.25 is a starting point on a few dozen
-- members; too low returns strangers, too high returns nothing, and the
-- right value depends on how long the names actually are.
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
         similarity(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), p_query) AS score
  FROM users u
  WHERE u.deleted_at IS NULL
    AND similarity(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), p_query) > p_threshold
  ORDER BY score DESC, u.first_name
  LIMIT p_limit;
$$;
