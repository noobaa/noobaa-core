/* Copyright (C) 2025 NooBaa */
"use strict";

async function run({ dbg, system_store }) {
    try {
        dbg.log0('starting remove lambda_triggers from buckets...');
        const buckets = system_store.data.buckets
            .map(b => b.lambda_triggers && ({
                _id: b._id,
                $unset: { lambda_triggers: true }
            }))
            .filter(Boolean);
        if (buckets.length > 0) {
            dbg.log0(`removing "lambda_triggers" from buckets: ${buckets.map(b => b._id).join(', ')}`);
            await system_store.make_changes({ update: { buckets } });
        } else {
            dbg.log0('remove lambda_triggers: no upgrade needed...');
        }
    } catch (err) {
        dbg.error('got error while removing lambda_triggers from buckets:', err);
        throw err;
    }
}

module.exports = {
    run,
    description: 'Remove lambda_triggers field from buckets'
};
