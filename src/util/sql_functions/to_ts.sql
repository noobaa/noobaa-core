CREATE OR REPLACE FUNCTION to_ts(value text) RETURNS timestamp AS $$
    select value::timestamp;
$$ LANGUAGE sql IMMUTABLE;
