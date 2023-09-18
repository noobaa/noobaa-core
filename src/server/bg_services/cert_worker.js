/* Copyright (C) 2023 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const ssl_utils = require('../../util/ssl_utils');

/**
 * Updates s3 https server(s) when certificate files are updated.
 * Note ODF rotates certificates every 13 months.
 * Some more details in operator's doc/ssl-dns-routing.md -
 * https://github.com/noobaa/noobaa-operator/blob/master/doc/ssl-dns-routing.md
 */
class CertWorker {

    /**
     * @param {{
     *   name: string;
     *   https_server: https.Server;
     *   sts_server: https.Server;
     * }} params
     */
    constructor({ name, https_server, sts_server }) {
        this.name = name;
        this.https_server = https_server;
        this.sts_server = sts_server;
    }

    async run_batch() {
        dbg.log2('cert_worker: running check for certificate update');
        if (await ssl_utils.update_certs_from_disk()) {
            //certificate were updated. give new cert to https servers.
            dbg.log0('cert_worker: updating certs');
            const ssl_cert = await ssl_utils.get_ssl_certificate('S3');
            const ssl_options = { ...ssl_cert, honorCipherOrder: true };
            this.https_server.setSecureContext(ssl_options);
            this.sts_server.setSecureContext(ssl_options);
        }
        //use same delay as core
        return config.CLUSTER_HB_INTERVAL;
    }
}

exports.CertWorker = CertWorker;
