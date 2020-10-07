CREATE OR REPLACE FUNCTION map_aggregate_blocks(TEXT) RETURNS TABLE(_id TEXT[], value NUMERIC) AS $$
DECLARE
    cur_query ALIAS FOR $1;
    rec_size NUMERIC;
    rec_bucket_id TEXT;
    rec_pool_id TEXT;
    rec RECORD;
    cur REFCURSOR;
BEGIN
  OPEN cur FOR EXECUTE cur_query; 
  FETCH NEXT FROM cur INTO rec;
  WHILE FOUND 
  LOOP
    rec_size := rec.data->'size';
    rec_bucket_id := rec.data->>'bucket';
    rec_pool_id := rec.data->>'pool';
    _id := ARRAY ['total', ''];
    value := rec_size;
    RETURN NEXT;
    _id := ARRAY ['bucket', rec_bucket_id];
    value := rec_size;
    RETURN NEXT;
    _id := ARRAY ['bucket_and_pool', rec_bucket_id, rec_pool_id];
    value := rec_size;
    RETURN NEXT;
    _id := ARRAY ['pool', rec_pool_id];
    value := rec_size;
    RETURN NEXT;
    FETCH NEXT FROM cur INTO rec; 
  END LOOP;
  CLOSE cur; 
END;
$$ LANGUAGE plpgsql;
