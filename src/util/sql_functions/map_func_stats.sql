CREATE OR REPLACE FUNCTION map_func_stats(TEXT) RETURNS TABLE(_id TEXT, time_stamp TEXT, value JSON) AS $$
DECLARE
    cur_query ALIAS FOR $1;
    time_took NUMERIC; 
    rec_err BOOLEAN;
    rec RECORD;
    cur REFCURSOR;
BEGIN
  OPEN cur FOR EXECUTE cur_query; 
  FETCH NEXT FROM cur INTO rec;
  WHILE FOUND 
  LOOP
    rec_err := rec.data->'error';
    IF rec_err THEN
        _id := 'rejected'; 
        time_stamp := rec.data->>'time';  
        value := json_build_object('invoked', 1, 'fulfilled', 0, 'rejected', 1, 'aggr_response_time', 0, 'max_response_time', 0, 'completed_response_times', ARRAY [time_took]);
    ELSE
        _id := 'fulfilled';
        time_stamp := rec.data->>'time';
        time_took := rec.data->>'took';
        value := json_build_object('invoked', 1, 'fulfilled', 1, 'rejected', 0, 'aggr_response_time', time_took, 'max_response_time', time_took, 'completed_response_times', ARRAY [time_took]);
    END IF;
    RETURN NEXT;
    FETCH NEXT FROM cur INTO rec; 
  END LOOP;
  CLOSE cur; 
END;
$$ LANGUAGE plpgsql;
