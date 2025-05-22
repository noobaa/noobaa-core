/* Copyright (C) 2016 NooBaa */
"use strict";

const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_warp_s3');

const { WARP_TEST } = require('./warp_constants.js');
const { create_warp_account, create_warp_bucket } = require('./warp_utils.js');

async function main() {
    try {
        await warp_test_setup();
    } catch (err) {
        console.error(`Warp Setup Failed: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

async function warp_test_setup() {
    console.info('WARP TEST CONFIGURATION:', JSON.stringify(WARP_TEST));
    await create_warp_account();
    await create_warp_bucket();
    console.info('WARP TEST SETUP DONE');
}

if (require.main === module) {
    main();
}


