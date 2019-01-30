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
    const noobaa_log_files = (await fs.readdirAsync('/log'))
        .filter(f => f.startsWith('noobaa'))
        .map(filename => '/log/' + filename);
    noobaa_log_files.push('/tmp/res_1.tgz'); // runner log files
    noobaa_log_files.push('/tmp/ceph_deploy.log'); // ceph build and deploy log
    await P.map(noobaa_log_files, async log_file => {
        try {
            const blob_key = process.env.TEST_RUN_NAME + '/' + log_file;
            await P.fromCallback(callback => blob.createBlockBlobFromLocalFile(CONTAINER, blob_key, log_file, callback));
        } catch (err) {
            console.error(`Failed uploading ${log_file} to azure`, err);
        }
    }, { concurrency: 10 });
}


if (require.main === module) {
    main();
}
