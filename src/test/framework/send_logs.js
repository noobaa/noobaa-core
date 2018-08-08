/* Copyright (C) 2016 NooBaa */
'use strict';

const azure_storage = require('azure-storage');
const fs = require('fs');

const P = require('../../util/promise');
const dotenv = require('../../util/dotenv');
dotenv.load();

const CONTAINER = 'vitaly-servers-logs';

async function main() {
    const blob = azure_storage.createBlobService(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const noobaa_log_files = (await fs.readdirAsync('/var/log')).filter(f => f.startsWith('noobaa'));
    await P.map(noobaa_log_files, async log_file => {
        const blob_key = process.env.TEST_RUN_NAME + '/' + log_file;
        await P.fromCallback(callback => blob.createBlockBlobFromLocalFile(CONTAINER, blob_key, '/var/log/' + log_file, callback));
    }, { concurrency: 10 });
}


if (require.main === module) {
    main();
}
