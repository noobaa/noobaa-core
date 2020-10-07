CREATE OR REPLACE FUNCTION map_aggregate_objects(TEXT) RETURNS TABLE(_id TEXT[], value NUMERIC) AS $$
DECLARE
    cur_query ALIAS FOR $1;
    pow NUMERIC;
    rec_size NUMERIC;
    rec_bucket_id TEXT;
    rec_content_type TEXT;
    rec RECORD;
    cur REFCURSOR;
BEGIN
  OPEN cur FOR EXECUTE cur_query; 
  FETCH NEXT FROM cur INTO rec;
  WHILE FOUND 
  LOOP
    rec_size := rec.data->'size';
    rec_bucket_id := rec.data->>'bucket';
    rec_content_type := rec.data->>'content_type';
    _id := ARRAY ['', 'size'];
    value := rec_size;
    RETURN NEXT;
    _id := ARRAY ['', 'count'];
    value := 1;
    RETURN NEXT;
    _id := ARRAY [rec_bucket_id, 'size'];
    value := rec_size;
    RETURN NEXT;
    _id := ARRAY [rec_bucket_id, 'count'];
    value := 1;
    RETURN NEXT;
    pow := 0;
    IF rec_size > 1 THEN
        pow := CEIL(LOG(2,rec_size));
    END IF;
    _id := ARRAY [rec_bucket_id, CONCAT('count_pow2_', pow)];
    value := 1;
    RETURN NEXT;
    _id := ARRAY [rec_bucket_id, CONCAT('size_pow2_', pow)];
    value := rec_size;
    RETURN NEXT;
    _id := ARRAY [rec_bucket_id, 'content_type', rec_content_type, 'count'];
    value := 1;
    RETURN NEXT;
    _id := ARRAY [rec_bucket_id, 'content_type', rec_content_type, 'size'];
    value := rec_size;
    RETURN NEXT;
    FETCH NEXT FROM cur INTO rec; 
  END LOOP;
  CLOSE cur; 
END;
$$ LANGUAGE plpgsql;
