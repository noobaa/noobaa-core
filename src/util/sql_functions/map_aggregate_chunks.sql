CREATE OR REPLACE FUNCTION map_aggregate_chunks(TEXT) RETURNS TABLE(_id TEXT[], value NUMERIC) AS $$
DECLARE
    cur_query ALIAS FOR $1;
    rec_compress_size NUMERIC;
    rec_size NUMERIC;
    rec_bucket_id TEXT;
    response_size NUMERIC;
    rec RECORD;
    cur REFCURSOR;
BEGIN
  OPEN cur FOR EXECUTE cur_query; 
  FETCH NEXT FROM cur INTO rec;
  WHILE FOUND 
  LOOP
    rec_compress_size := rec.data->'compress_size';
    rec_size := rec.data->'size';
    response_size := COALESCE(rec_compress_size, rec_size);
    rec_bucket_id := rec.data->>'bucket';
    _id := ARRAY ['', 'compress_size'];
    value := response_size;
    RETURN NEXT;
    _id := ARRAY [rec_bucket_id, 'compress_size'];
    value := response_size;
    RETURN NEXT;
    FETCH NEXT FROM cur INTO rec; 
  END LOOP;
  CLOSE cur; 
END;
$$ LANGUAGE plpgsql;
