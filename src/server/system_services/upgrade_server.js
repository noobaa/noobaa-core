/* Copyright (C) 2016 NooBaa */
/* eslint max-lines: ['error', 2500] */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const url = require('url');
const request = require('request');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const cutil = require('../utils/clustering_utils');
const MongoCtrl = require('../utils/mongo_ctrl');
const server_rpc = require('../server_rpc');
const Dispatcher = require('../notifications/dispatcher');
const system_store = require('./system_store').get_instance();
const promise_utils = require('../../util/promise_utils');

const upgrade_utils = require('../../upgrade/upgrade_utils');

// TODO: maybe we need to change it to use upgrade status in DB.
// currently use this memory only flag to indicate if upgrade is still in process
let upgrade_in_process = false;


function member_pre_upgrade(req) {
    dbg.log0('UPGRADE: received upgrade package:, ', req.rpc_params.filepath, req.rpc_params.mongo_upgrade ?
        'this server should preform mongo_upgrade' :
        'this server should not preform mongo_upgrade');
    let server = system_store.get_local_cluster_info(); //Update path in DB
    dbg.log0('update upgrade for server: ', cutil.get_cluster_info().owner_address);
    let upgrade = _.omitBy({
        path: req.rpc_params.filepath,
        mongo_upgrade: req.rpc_params.mongo_upgrade,
        status: req.rpc_params.stage === 'UPGRADE_STAGE' ? 'PRE_UPGRADE_PENDING' : 'PENDING',
        package_uploaded: req.rpc_params.stage === 'UPLOAD_STAGE' ? Date.now() : server.upgrade.package_uploaded,
        staged_package: req.rpc_params.stage === 'UPLOAD_STAGE' ? 'UNKNOWN' : server.upgrade.staged_package
    }, _.isUndefined);

    dbg.log0('UPGRADE:', 'updating cluster for server._id', server._id, 'with upgrade =', upgrade);

    return system_store.make_changes({
            update: {
                clusters: [{
                    _id: server._id,
                    upgrade: upgrade
                }]
            }
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({ secret: system_store.get_server_secret() }, 'change_upgrade_status'))
        .then(() => upgrade_utils.pre_upgrade({
            upgrade_path: upgrade.path,
            extract_package: req.rpc_params.stage === 'UPLOAD_STAGE'
        }))
        .then(res => {
            //Update result of pre_upgrade and message in DB
            if (res.result) {
                dbg.log0('UPGRADE:', 'get res.result =', res.result, ' setting status to CAN_UPGRADE');
                upgrade.status = req.rpc_params.stage === 'UPGRADE_STAGE' ? 'PRE_UPGRADE_READY' : 'CAN_UPGRADE';
            } else {
                dbg.log0('UPGRADE:', 'get res.result =', res.result, ' setting status to FAILED');
                upgrade.status = 'FAILED';
                dbg.error('UPGRADE HAD ERROR: ', res.error);
                // TODO: Change that shit to more suitable error handler
                upgrade.error = res.error;
                if (req.rpc_params.stage === 'UPGRADE_STAGE') {
                    upgrade_in_process = false;
                }
            }

            if (req.rpc_params.stage === 'UPLOAD_STAGE') {
                upgrade.staged_package = res.staged_package || 'UNKNOWN';
            }
            upgrade.tested_date = res.tested_date;

            dbg.log0('UPGRADE:', 'updating cluster again for server._id', server._id, 'with upgrade =', upgrade);

            return system_store.make_changes({
                update: {
                    clusters: [{
                        _id: server._id,
                        upgrade: upgrade
                    }]
                }
            });
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({ secret: system_store.get_server_secret() }, 'change_upgrade_status'))
        .return();
}

function do_upgrade(req) {
    system_store.load()
        .then(() => {
            dbg.log0('UPGRADE:', 'got do_upgrade');
            let server = system_store.get_local_cluster_info();
            if (server.upgrade.status !== 'UPGRADING') {
                dbg.error('Not in upgrade state:', ' State Is: ', server.upgrade.status || 'NO_STATUS');
                throw new Error('Not in upgrade state:', server.upgrade.error ? server.upgrade.error : '',
                    ' State Is: ', server.upgrade.status || 'NO_STATUS');
            }
            if (server.upgrade.path === '') {
                dbg.error('No package path supplied');
                throw new Error('No package path supplied');
            }
            let filepath = server.upgrade.path;
            //Async as the server will soon be restarted anyway
            const on_err = err => {
                dbg.error('upgrade scripted failed. Aborting upgrade:', err);
                upgrade_in_process = false;
                _handle_cluster_upgrade_failure(err, server.owner_address);
            };
            upgrade_utils.do_upgrade(filepath, server.is_clusterized, on_err);
        });
}

function get_upgrade_status(req) {
    return { in_process: upgrade_in_process };
}

function cluster_pre_upgrade(req) {
    dbg.log0('cluster_pre_upgrade:', cutil.pretty_topology(cutil.get_topology()));
    // get all cluster members other than the master
    const cinfo = system_store.get_local_cluster_info();
    const upgrade_path = req.rpc_params.filepath || _get_upgrade_path();

    return P.resolve()
        .then(() => {
            if (!upgrade_path) {
                throw new Error('cluster_pre_upgrade: must include path');
            }
            const secondary_members = cutil.get_all_cluster_members().filter(ip => ip !== cinfo.owner_address);
            dbg.log0('cluster_pre_upgrade:', 'secondaries =', secondary_members);

            return P.fcall(() => {
                    if (cinfo.is_clusterized) {
                        return MongoCtrl.is_master()
                            .then(res => res.ismaster);
                    }
                    return true;
                })
                .then(is_master => {
                    if (!is_master) {
                        throw new Error('cluster_pre_upgrade: upgrade must be done on master node');
                    }

                    dbg.log0('cluster_pre_upgrade:', 'calling member_pre_upgrade');
                    server_rpc.client.upgrade.member_pre_upgrade({
                            filepath: upgrade_path,
                            mongo_upgrade: false,
                            stage: req.rpc_params.filepath ? 'UPLOAD_STAGE' : 'RETEST_STAGE'
                        })
                        .catch(err => {
                            dbg.error('cluster_pre_upgrade:', 'pre_upgrade failed on master - aborting upgrade', err);
                            throw err;
                        });
                })
                .then(() => {
                    // upload package to secondaries
                    dbg.log0('cluster_pre_upgrade:', 'uploading package to all cluster members');
                    // upload package to cluster members
                    return P.all(secondary_members.map(ip => _upload_package(upgrade_path, ip)
                        .catch(err => {
                            dbg.error('upgrade_cluster failed uploading package', err);
                            return _handle_cluster_upgrade_failure(new Error('DISTRIBUTION_FAILED'), ip);
                        })
                    ));
                });
        })
        .return();
}

async function upgrade_cluster(req) {
    dbg.log0('UPGRADE got request to upgrade the cluster:', cutil.pretty_topology(cutil.get_topology()));
    // get all cluster members other than the master
    let cinfo = system_store.get_local_cluster_info();
    if (cinfo.upgrade.status !== 'CAN_UPGRADE' && cinfo.upgrade.status !== 'UPGRADE_FAILED') {
        throw new Error('Not in upgrade state:', cinfo.upgrade.error ? cinfo.upgrade.error : '');
    }
    const upgrade_path = _get_upgrade_path();
    // upgrade can only be called from master. throw error otherwise
    upgrade_in_process = true;

    const is_master = cinfo.is_clusterized ? await MongoCtrl.is_master() : true;
    if (!is_master) {
        throw new Error('UPGRADE upgrade must be done on master node');
    }

    const updates = system_store.data.clusters.map(cluster => ({
        _id: cluster._id,
        $set: {
            "upgrade.initiator_email": req.account.email,
            // This is a patch that was done in order so the FE won't wait for tests prior to upgrade
            // We set this once again inside the member_pre_upgrade
            "upgrade.status": 'PRE_UPGRADE_PENDING'
        },
        $unset: {
            "upgrade.error": 1
        }
    }));
    await system_store.make_changes({
        update: {
            clusters: updates
        }
    });

    // Notice that we do not await here on purpose so the FE won't wait for the completion of the tests
    _test_and_upgrade_in_background(cinfo, upgrade_path, req);
}

function reset_upgrade_package_status(req) {
    const updates = system_store.data.clusters.map(cluster => ({
        _id: cluster._id,
        $set: {
            'upgrade.status': 'COMPLETED'
        }
    }));
    Dispatcher.instance().activity({
        event: 'conf.upload_package',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
    });

    return system_store.make_changes({
            update: {
                clusters: updates
            }
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({ secret: system_store.get_server_secret() }, 'change_upgrade_status'));
}

async function _test_and_upgrade_in_background(cinfo, upgrade_path, req) {

    const all_members = cutil.get_all_cluster_members();
    const secondary_members = all_members.filter(ip => ip !== cinfo.owner_address);
    dbg.log0('UPGRADE:', 'secondaries =', secondary_members);


    dbg.log0('UPGRADE:', 'testing package in all cluster members');
    const member_tests = all_members.map(async ip => {
        const is_master = ip === cinfo.owner_address;
        if (is_master) {
            try {
                dbg.log0('UPGRADE:', 'calling member_pre_upgrade');
                await server_rpc.client.upgrade.member_pre_upgrade({
                    filepath: upgrade_path,
                    mongo_upgrade: true,
                    stage: 'UPGRADE_STAGE'
                });
            } catch (err) {

                dbg.error('UPGRADE:', 'pre_upgrade failed on master - aborting upgrade', err);
                throw err;
            }
        } else {
            try {
                await server_rpc.client.upgrade.member_pre_upgrade({
                    filepath: system_store.data.clusters
                        .find(cluster => (String(cluster.owner_address) === String(ip)))
                        .upgrade.path,
                    mongo_upgrade: false,
                    stage: 'UPGRADE_STAGE'
                }, {
                    address: server_rpc.get_base_address(ip),
                });
            } catch (err) {
                dbg.error('upgrade_cluster failed uploading package', err);
                await _handle_cluster_upgrade_failure(new Error('DISTRIBUTION_FAILED'), ip);
            }
        }

    });

    try {
        // wait for all members to run tests
        await P.all(member_tests);
        //wait for all members to reach PRE_UPGRADE_READY. if one failed fail the upgrade
        dbg.log0('UPGRADE:', 'waiting for secondaries to reach PRE_UPGRADE_READY');
        for (const ip of all_members) {
            dbg.log0('UPGRADE:', 'waiting for server', ip, 'to reach PRE_UPGRADE_READY');
            await _wait_for_upgrade_state(ip, 'PRE_UPGRADE_READY');
        }

        Dispatcher.instance().activity({
            event: 'conf.system_upgrade_started',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
        });

        //Update all clusters upgrade section with the new status and clear the error if exists
        const cluster_updates = system_store.data.clusters.map(cluster => ({
            _id: cluster._id,
            $set: {
                "upgrade.status": 'UPGRADING'
            },
            $unset: {
                "upgrade.error": true
            }
        }));
        //set last upgrade initiator under system
        const system_updates = [{
            _id: req.system._id,
            $set: {
                "last_upgrade.initiator": (req.account && req.account.email) || ''
            }
        }];
        await system_store.make_changes({
            update: {
                clusters: cluster_updates,
                systems: system_updates
            }
        });

        await Dispatcher.instance().publish_fe_notifications({}, 'change_upgrade_status');

        await _handle_upgrade_stage({ secondary_members, upgrade_path });

    } catch (err) {
        dbg.error('Got error when running upgrade in background', err);
        // TODO: we should try to fix everything and restore system.
        // check if rollback is necessary or even possible
    }
}

function _handle_cluster_upgrade_failure(err, ip) {
    return P.resolve()
        .then(() => {
            dbg.error('_handle_cluster_upgrade_failure: got error on cluster upgrade', err);
            upgrade_in_process = false;
            const fe_notif_params = {};
            const change = {
                "upgrade.status": 'UPGRADE_FAILED',
                "upgrade.error": 'Upgrade has failed with an interal error.'
            };
            let updates;
            if (ip) {
                updates = [{
                    _id: system_store.data.clusters.find(cluster => {
                        if (String(cluster.owner_address) === String(ip)) {
                            fe_notif_params.secret = cluster.owner_secret;
                            return true;
                        }
                        return false;
                    })._id,
                    $set: change
                }];
            } else {
                updates = system_store.data.clusters.map(cluster => ({
                    _id: cluster._id,
                    $set: change
                }));
            }
            return system_store.make_changes({
                    update: {
                        clusters: updates
                    }
                })
                .then(() => Dispatcher.instance().publish_fe_notifications(fe_notif_params, 'change_upgrade_status'))
                .finally(() => {
                    throw err;
                });
        });
}

function _handle_upgrade_stage(params) {
    // We do not return on purpose!
    P.each(params.secondary_members, ip => {
            dbg.log0('UPGRADE:', 'sending do_upgrade to server', ip, 'and and waiting for DB_READY state');
            return server_rpc.client.upgrade.do_upgrade({}, {
                    address: server_rpc.get_base_address(ip)
                })
                .then(() => _wait_for_upgrade_stage(ip, 'DB_READY'))
                .then(() => Dispatcher.instance().publish_fe_notifications({
                    secret: system_store.data.clusters.find(cluster => (String(cluster.owner_address) === String(ip))).owner_secret
                }, 'change_upgrade_status'))
                .catch(err => {
                    dbg.error('UPGRADE:', 'got error on upgrade of server', ip, 'aborting upgrade process', err);
                    return _handle_cluster_upgrade_failure(err, ip);
                });
        })
        // after all secondaries are upgraded it is safe to upgrade the primary.
        // secondaries should wait (in upgrade.js) for primary to complete upgrade and perform mongo_upgrade
        .then(() => {
            dbg.log0('UPGRADE:', 'calling do_upgrade on master');
            return server_rpc.client.upgrade.do_upgrade({
                filepath: params.upgrade_path
            });
        })
        .then(() => Dispatcher.instance().publish_fe_notifications({ secret: system_store.get_server_secret() }, 'change_upgrade_status'))
        .catch(err => {
            dbg.error('_handle_upgrade_stage got error on cluster upgrade', err);
            upgrade_in_process = false;
        });
}

function _wait_for_upgrade_state(ip, state) {
    let max_retries = 60;
    const upgrade_retry_delay = 10 * 1000; // the delay between testing upgrade status
    return promise_utils.retry(max_retries, upgrade_retry_delay, () => system_store.load()
        .then(() => {
            dbg.log0('UPGRADE:', 'wating for', ip, 'to reach', state);
            let status = cutil.get_member_upgrade_status(ip);
            dbg.log0('UPGRADE:', 'got status:', status);
            if (status !== state) {
                dbg.error('UPGRADE:', 'timedout waiting for ' + ip + ' to reach ' + state);
                if (status === 'FAILED') max_retries = 0;
                throw new Error('timedout waiting for ' + ip + ' to reach ' + state);
            }
        })
    );
}

function _wait_for_upgrade_stage(ip, stage_req) {
    let max_retries = 60;
    const upgrade_retry_delay = 10 * 1000; // the delay between testing upgrade status
    return promise_utils.retry(max_retries, upgrade_retry_delay, () => system_store.load()
        .then(() => {
            dbg.log0('UPGRADE:', 'wating for', ip, 'to reach', stage_req);
            let stage = cutil.get_member_upgrade_stage(ip);
            dbg.log0('UPGRADE:', 'got stage:', stage);
            if (stage !== stage_req) {
                dbg.error('UPGRADE:', 'timedout waiting for ' + ip + ' to reach ' + stage_req);
                // if (stage === 'FAILED') max_retries = 0;
                throw new Error('timedout waiting for ' + ip + ' to reach ' + stage_req);
            }
        })
    );
}

function _upload_package(pkg_path, ip) {
    var formData = {
        upgrade_file: {
            value: fs.createReadStream(pkg_path),
            options: {
                filename: 'noobaa.tar.gz',
                contentType: 'application/x-gzip'
            }
        }
    };
    let target = url.format({
        protocol: 'http',
        slashes: true,
        hostname: ip,
        port: process.env.PORT,
        pathname: 'upload_package'
    });
    return P.ninvoke(request, 'post', {
            url: target,
            formData: formData,
            rejectUnauthorized: false,
        })
        .then((httpResponse, body) => {
            console.log('Upload package successful:', body);
        });
}

function _get_upgrade_path() {
    let server = system_store.get_local_cluster_info();
    // if (server.upgrade.status !== 'CAN_UPGRADE') {
    //     throw new Error('Not in upgrade state:', server.upgrade.error ? server.upgrade.error : '');
    // }
    if (server.upgrade.path === '') {
        throw new Error('No package path supplied');
    }
    return server.upgrade.path;
}

// EXPORTS
exports.member_pre_upgrade = member_pre_upgrade;
exports.do_upgrade = do_upgrade;
exports.upgrade_cluster = upgrade_cluster;
exports.get_upgrade_status = get_upgrade_status;
exports.cluster_pre_upgrade = cluster_pre_upgrade;
exports.reset_upgrade_package_status = reset_upgrade_package_status;
