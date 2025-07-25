/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');

const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('MongoMonitor');

const os_utils = require('../../util/os_utils');

const TEST_STATUS_DELAY = 10000;

let previous_master;


async function get_mongo_rs_status_from_shell() {
    const rs_status_str = await os_utils.exec('mongors nbcore --quiet --port 27000 --eval "JSON.stringify(rs.status())" | grep -v " W NETWORK"', {
        ignore_rc: true,
        return_stdout: true
    });
    const rs_status = JSON.parse(rs_status_str);
    dbg.log3(`got rs_status = ${util.inspect(rs_status)}`);
    return rs_status;
}

async function test_mongo_status() {
    let rs_status;
    try {
        rs_status = await get_mongo_rs_status_from_shell();
    } catch (err) {
        dbg.error('got error on get_mongo_rs_status_from_shell:', err);
        return;
    }

    if (!rs_status) {
        dbg.error('get_mongo_rs_status_from_shell did not return rs_status');
        return;
    }

    try {
        const master = rs_status.members.find(member => member.stateStr === 'PRIMARY');
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
                await os_utils.exec('supervisorctl restart bg_workers hosted_agents s3rver webserver');
            }
        } else {
            dbg.log0('initing previous master to', master.name);
            previous_master = master.name;
        }

    } catch (err) {
        dbg.error('error on test_mongo_status:', err);
    }
}

setInterval(test_mongo_status, TEST_STATUS_DELAY);
