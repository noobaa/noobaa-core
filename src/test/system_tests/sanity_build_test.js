"use strict";

var _ = require('lodash');
var P = require('../../util/promise');
var ops = require('./basic_server_ops');
var argv = require('minimist')(process.argv);

function show_usage() {
    console.error('usage: node sanity_build_test.js <--upgrade_pack path_to_upgrade_pack> <--target_ip ip>');
    console.error('   example: node sanity_build_test.js --target_ip 172.0.0.1 --upgrade_pack ../build/public/noobaa-NVA.tar.gz');
    console.error(' upgrade_pack -\t\tPath to upgrade pack to use in the upgrade process');
    console.error('\n');
}

function stop() {
    process.exit(3);
    return;
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
    return P.when(ops.upload_and_upgrade(argv.target_ip, argv.upgrade_pack))
        .fail(function(error) {
            console.warn('Upgrading failed with', error, error.stack);
            stop();
        })
       .then(function() {
            console.log('Upgrading successful, generating 1MB file');
            return ops.generate_random_file(1)
                .then(function(path) {
                    console.log('Verifying ul/dl of 1MB file', path);
                    return ops.verify_upload_download(argv.target_ip, path);
                })
                .fail(function(error) {
                    console.warn('Verifying ul/dl 1MB file failed with', error, error.stack);
                    stop();
                });
        })
        .then(function() {
            console.log('ul/dl 1MB file successful, generating 20MB file');
            return ops.generate_random_file(20)
                .then(function(path) {
                    console.log('Verifying ul/dl of 20MB file', path);
                    return ops.verify_upload_download(argv.target_ip, path);
                })
                .fail(function(error) {
                    console.warn('Verifying ul/dl 20MB file failed with', error, error.stack);
                    stop();
                });
        })
        .then(function() {
            console.log('ul/dl 20MB file successful, verifying agent download');
            return ops.get_agent_setup(argv.target_ip)
                .fail(function(error) {
                    console.warn('Verifying agent download failed with', error, error.stack);
                    stop();
                });
        })
        .then(function() {
            console.log('Basic sanity test passed!');
            process.exit(0);
            return;
        });
}

if (require.main === module) {
    main();
}
