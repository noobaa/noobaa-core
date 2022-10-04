/* Copyright (C) 2016 NooBaa */
/**
 *
 * EVENT_SERVER
 *
 */
'use strict';

const fs = require('fs');
const dbg = require('../../util/debug_module')(__filename);
const Dispatcher = require('../notifications/dispatcher');

/**
 *
 * READ_ACTIVITY_LOG
 *
 */
function read_activity_log(req) {
    return Dispatcher.instance().read_activity_log(req);
}

/**
 *
 * EXPORT_ACTIVITY_LOG
 *
 */
function export_activity_log(req) {

    //limit to 100000 lines just in case (probably ~10MB of text)

    // generate csv file name:
    const file_name = 'audit.csv';
    const out_path = `/public/${file_name}`;
    const inner_path = `/log/${file_name}`;
    req.rpc_params.limit = req.rpc_params.limit || 100000;
    return Dispatcher.instance().read_activity_log(req)
        .then(logs => {
            let out_lines = logs.logs.reduce(
                (lines, entry) => {
                    let time = (new Date(entry.time)).toISOString();
                    let entity_type = entry.event.split('.')[0];
                    let account = entry.actor ? entry.actor.email : '';
                    let entity = entry[entity_type];
                    let description = entry.desc ? entry.desc.join(' ') : '';
                    let entity_name = '';
                    if (entity) {
                        entity_name = entity_type === 'obj' ? entity.key : entity.name;
                    }

                    lines.push(`"${time}",${entry.level},${account},${entry.event},${entity_name},"${description}"`);
                    return lines;
                }, ['time,level,account,event,entity,description']
            );

            return fs.promises.writeFile(inner_path, out_lines.join('\n'), 'utf8');
        })
        .then(() => ({out_path}))
        .catch(err => {
            dbg.error('received error when writing to audit csv file:', inner_path, err);
            throw err;
        });
}

/**
 *
 * ALERTS API - Redirection to Dispatcher
 *
 */
function get_unread_alerts_count(req) {
    return Dispatcher.instance().get_unread_alerts_count(req.system._id);
}

function update_alerts_state(req) {
    return Dispatcher.instance().update_alerts_state(req);
}

function read_alerts(req) {
    return Dispatcher.instance().read_alerts(req);
}


// EXPORTS
exports.read_activity_log = read_activity_log;
exports.export_activity_log = export_activity_log;
exports.get_unread_alerts_count = get_unread_alerts_count;
exports.update_alerts_state = update_alerts_state;
exports.read_alerts = read_alerts;
