oc rsh -n openshift-storage -c db noobaa-db-pg-0 df -h

oc rsh -n openshift-storage -c db noobaa-db-pg-0 psql nbcore -P pager=off <<EOF
\l+
\d+
\C "buckets by deleted"
SELECT 
    data->'deleted' is not null as "deleted",
    data->'deleting' is not null as "deleting",
    count(*)
FROM buckets GROUP BY 1, 2;
\C
\C "accounts by deleted"
SELECT 
    data->'deleted' is not null as "deleted",
    count(*)
FROM accounts GROUP BY 1;
\C
SELECT * FROM pg_stat_user_tables;
SELECT * FROM pg_stat_user_indexes;
SELECT * FROM pg_statio_user_tables;
SELECT * FROM pg_statio_user_indexes;
SELECT * FROM pg_stat_sys_tables;
SELECT * FROM pg_stat_sys_indexes;
SELECT * FROM pg_statio_sys_tables;
SELECT * FROM pg_statio_sys_indexes;
SELECT * FROM pg_stat_activity;
EOF
