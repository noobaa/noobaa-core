/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';


function update_usage_report_fields() {
    // clean unnecessary fileds from usage reports
    db.usagereports.updateMany({}, {
        $unset: {
            first_sample_time: 1,
            aggregated_time_range: 1,
            aggregated_time: 1
        }
    });
}

function unset_bucket_stats() {
    db.buckets.updateMany({}, {
        $unset: {
            stats: 1
        }
    });
}


update_usage_report_fields();
unset_bucket_stats();
