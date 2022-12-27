CREATE OR REPLACE FUNCTION map_common_prefixes(prefix TEXT, delimiter TEXT, query_filter TEXT, sort TEXT, max_keys INTEGER) RETURNS TABLE(_id TEXT[], value JSON) AS $$
DECLARE
    total_count INTEGER := 0;
    suffix TEXT;
    pos INTEGER;
    cut_prefix TEXT;
    rec_key TEXT;
    rec_id TEXT;
    cur_query TEXT;
    next_marker_query TEXT;
    next_marker TEXT;
    rec RECORD;
    cur REFCURSOR;
BEGIN
  cur_query := 'SELECT * FROM objectmds WHERE ' || query_filter || ' ORDER BY ' || sort;
  OPEN cur FOR EXECUTE cur_query; 
  FETCH NEXT FROM cur INTO rec;
  WHILE FOUND AND total_count < max_keys
    LOOP
      rec_key := rec.data->>'key';
      suffix := substring(rec_key from length(prefix) + 1);
      pos := position(delimiter in suffix);

      IF pos > 0 THEN
          cut_prefix := substring(suffix from 1 for pos);
          _id := ARRAY [cut_prefix, 'common_prefix'];
          value := null;
          -- a common prefix is found, so we can skip the rest of the keys with the same prefix
          -- as the next_marker, use the common prefix "incremented" by 1 (inc the last char)
          next_marker := prefix || substring(cut_prefix from 1 for length(cut_prefix) - 1) || chr(ascii(delimiter) + 1);
          cur_query:= 'SELECT * FROM objectmds WHERE ' || query_filter || ' AND data->>' || quote_literal('key') || ' >= ' || quote_literal(next_marker) || ' ORDER BY ' || sort;
          CLOSE cur;
          OPEN cur FOR EXECUTE cur_query;
      ELSE
          rec_id := rec.data->>'_id';
          _id := ARRAY [suffix, rec_id];
          value := rec.data;
      END IF;
      total_count := total_count + 1;
      RETURN NEXT;
      FETCH NEXT FROM cur INTO rec; 
    END LOOP;
  CLOSE cur; 
END;
$$ LANGUAGE plpgsql;