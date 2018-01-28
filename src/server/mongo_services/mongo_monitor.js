/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const dbg = require('../../util/debug_module')(__filename);
const promise_utils = require('../../util/promise_utils');
const P = require('../../util/promise');

dbg.set_process_name('MongoMonitor');

const TEST_STATUS_DELAY = 10000;

let previous_master;


function get_mongo_rs_status_from_shell() {
    return promise_utils.exec('mongors nbcore --quiet --port 27000 --eval "JSON.stringify(rs.status())" | grep -v " W NETWORK"', {
            ignore_rc: true,
            return_stdout: true
        })
        .then(rs_status_str => {
            let rs_status = JSON.parse(rs_status_str);
            dbg.log3(`got rs_status = ${util.inspect(rs_status)}`);
            return rs_status;
        });
}

function test_mongo_status() {
    return get_mongo_rs_status_from_shell()
        .catch(err => {
            dbg.error('got error on get_mongo_rs_status_bash:', err);
        })
        .then(rs_status => {
            if (!rs_status) {
                dbg.error('get_mongo_rs_status_bash did not return rs_status');
                return;
            }

            let master = rs_status.members.find(member => member.stateStr === 'PRIMARY');
            if (!master) {
                dbg.warn('PRIMARY member not found. rs_status =', util.inspect(rs_status));
                previous_master = 'no_primary';
                return;
            }
            dbg.log1('PRIMARY member found:', master);
            if (previous_master) {
                dbg.log2(`previous_master=${previous_master}  new_master=${master.name}`);
                // check if master is chaged:
                if (master.name !== previous_master) {
                    previous_master = master.name;
                    dbg.log0(`MASTER CHANGED to ${master.name} restarting the following services: bg_workers, hosted_agents, s3rver, webserver`);
                    return promise_utils.exec('supervisorctl restart bg_workers hosted_agents s3rver webserver');
                }
            } else {
                dbg.log0('initing previous master to', master.name);
                previous_master = master.name;
            }
        });
}

promise_utils.pwhile(
    () => true,
    () => test_mongo_status()
    .delay(TEST_STATUS_DELAY)
    .catch(err => {
        dbg.error('error on test_mongo_status:', err);
        return P.delay(TEST_STATUS_DELAY);
    })
);
