'use strict';

const util = require('util');
const dbg = require('./debug_module')(__filename);
const promise_utils = require('./promise_utils');

const TEST_STATUS_DELAY = 10000;

let previous_master;


function get_mongo_rs_status_bash() {
    return promise_utils.exec('mongo nbcore --quiet --port 27000 --eval "JSON.stringify(rs.status())"', true, true)
        .then(rs_status_str => {
            let rs_status = JSON.parse(rs_status_str);
            dbg.log3(`got rs_status = ${util.inspect(rs_status)}`);
            return rs_status;
        });
}

function test_mongo_status() {
    return get_mongo_rs_status_bash()
        .then(rs_status => {
            if (!rs_status) {
                dbg.error('get_mongo_rs_status_bash did not return rs_status');
                return;
            }

            let master = rs_status.members.find(member => member.stateStr === 'PRIMARY');
            if (!master) {
                dbg.warn('PRIMARY member not found. rs_status =', util.inspect(rs_status));
                return;
            }
            dbg.log0('PRIMARY member found:', master);
            if (!previous_master) {
                dbg.log0('initing previous master to', master.name);
                previous_master = master.name;
            } else {
                dbg.log2(`previous_master=${previous_master}  new_master=${master.name}`);
                // check if master is chaged:
                if (master.name !== previous_master) {
                    previous_master = master.name;
                    dbg.log0('MASTER CHANGED!!!! restarting the following services: bg_workers, hosted_agents, s3rver, webserver');
                    return promise_utils.exec('supervisorctl restart bg_workers hosted_agents s3rver webserver');
                }
            }
        })
        .catch(err => {
            dbg.error('error on test_mongo_status:', err);
        })
        .delay(TEST_STATUS_DELAY)
        .then(test_mongo_status);
}

test_mongo_status();
