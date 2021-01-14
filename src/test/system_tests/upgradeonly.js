/* Copyright (C) 2016 NooBaa */
"use strict";

var _ = require('lodash');
var P = require('../../util/promise');
var ops = require('../utils/basic_server_ops');
var argv = require('minimist')(process.argv);

function show_usage() {
    console.error('usage: node upgradeonly.js <--upgrade_pack path_to_upgrade_pack> <--target_ip ip>');
    console.error('   example: node upgradeonly.js --target_ip localhost --upgrade_pack ../build/public/noobaa-NVA.tar.gz');
    console.error(' upgrade_pack -\t\tPath to upgrade pack to use in the upgrade process');
    console.error('\n');
}

function stop() {
    process.exit(3);

}

function main() {
    if (_.isUndefined(argv.upgrade_pack)) {
        console.error('Missing upgrade_pack paramter!');
        show_usage();
        stop();
    }

    if (_.isUndefined(argv.target_ip)) {
        console.error('Missing target_ip paramter!');
        show_usage();
        process.exit(3);
        return;
    }

    console.log('Upgrading MD server at', argv.target_ip);
    return P.resolve(ops.upload_and_upgrade(argv.target_ip, argv.upgrade_pack))
        .catch(function(error) {
            console.warn('Upgrading failed with', error, error.stack);
            stop();
        })
        .then(function() {
            console.log('Upgrade only passed!');
            process.exit(0);

        });
}

if (require.main === module) {
    main();
}
