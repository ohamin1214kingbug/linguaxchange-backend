-- max_students has been stored since classes were introduced but never
-- enforced: routes/enrollments.js inserted a seat with no capacity check, so
-- a class could be joined past its own limit.
--
-- Enforced in the database rather than in the route because a plain
-- "count then insert" in app code is racy: two students clicking Join at
-- the same moment both read the same count, both pass, and the class ends
-- up one over. The FOR UPDATE below serialises joins to the same session so
-- the count a transaction reads can't go stale before it inserts. It also
-- means every insert path is covered, not just the one route.
--
-- Cancelling an enrollment hard-deletes the row (routes/enrollments.js
-- DELETE /:id), so a plain count of rows is an accurate seat count — no
-- status filter needed here.
-- SECURITY DEFINER so the seat count is never filtered by row-level
-- security. The backend's service-role key bypasses RLS today, which would
-- make SECURITY INVOKER work by accident — but if any path ever inserted
-- under a restricted role, an INVOKER count would see only that role's own
-- rows, read 0, and wave every join through. A capacity guard that silently
-- stops guarding is worse than none. search_path is pinned because a
-- DEFINER function otherwise resolves table names against the caller's.
CREATE OR REPLACE FUNCTION enforce_class_capacity()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  seat_limit INT;
  seats_taken INT;
BEGIN
  -- Lock the session row before counting. Locking the parent keeps joins to
  -- *other* sessions running in parallel.
  SELECT c.max_students INTO seat_limit
  FROM class_sessions s
  JOIN classes c ON c.id = s.class_id
  WHERE s.id = NEW.class_session_id
  FOR UPDATE OF s;

  -- No such session: let the foreign key raise the real error rather than
  -- masking it with a confusing "full" message.
  IF seat_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO seats_taken
  FROM class_enrollments
  WHERE class_session_id = NEW.class_session_id;

  IF seats_taken >= seat_limit THEN
    -- Sentinel string, matched by utils/enrollmentCapacity.js. Both ends of
    -- this are ours, unlike a third-party message that could be reworded.
    RAISE EXCEPTION 'CLASS_SESSION_FULL';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS class_enrollments_capacity ON class_enrollments;
CREATE TRIGGER class_enrollments_capacity
  BEFORE INSERT ON class_enrollments
  FOR EACH ROW EXECUTE FUNCTION enforce_class_capacity();
