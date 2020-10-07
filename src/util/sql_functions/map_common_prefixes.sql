CREATE OR REPLACE FUNCTION map_common_prefixes(TEXT, TEXT, TEXT) RETURNS TABLE(_id TEXT[], value JSON) AS $$
DECLARE
    prefix ALIAS FOR $1;
    delimiter ALIAS FOR $2;
    cur_query ALIAS FOR $3;
    suffix TEXT;
    pos INTEGER;
    cut_prefix TEXT;
    rec_key TEXT;
    rec_id TEXT;
    rec RECORD;
    cur REFCURSOR;
BEGIN
  OPEN cur FOR EXECUTE cur_query; 
  FETCH NEXT FROM cur INTO rec;
  WHILE FOUND 
  LOOP
    rec_key := rec.data->>'key';
    suffix := substring(rec_key from length(prefix) + 1);
    pos := position(delimiter in suffix);
    IF pos > 0 THEN
        cut_prefix := substring(suffix from 1 for pos);
        _id := ARRAY [cut_prefix, 'common_prefix'];
        value := null;
    ELSE
        rec_id := rec.data->>'_id';
        _id := ARRAY [suffix, rec_id];
        value := rec.data;
    END IF;
    RETURN NEXT;
    FETCH NEXT FROM cur INTO rec; 
  END LOOP;
  CLOSE cur; 
END;
$$ LANGUAGE plpgsql;
