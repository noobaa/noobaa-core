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
    req.rpc_params.csv = true;

    // generate csv file name:
    const file_name = 'audit.csv';
    const out_path = `/public/${file_name}`;
    const inner_path = `${process.cwd()}/build${out_path}`;

    return Dispatcher.instance().read_activity_log(req)
        .then(logs => {
            let lines = logs.logs.reduce(
                (lines, entry) => {
                    let time = (new Date(entry.time)).toISOString();
                    let entity_type = entry.event.split('.')[0];
                    let account = entry.actor ? entry.actor.email : '';
                    let entity = entry[entity_type];
                    let description = entry.desc.join(' ');
                    let entity_name = entity ?
                        (entity_type === 'obj' ? entity.key : entity.name) :
                        '';

                    lines.push(`"${time}",${entry.level},${account},${entry.event},${entity_name},"${description}"`);
                    return lines;
                }, ['time,level,account,event,entity,description']
            );

            return fs.writeFileAsync(inner_path, lines.join('\n'), 'utf8');
        })
        .then(() => out_path)
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

function mark_alerts_read(req) {
    return Dispatcher.instance().mark_alerts_read(req);
}

function read_alerts(req) {
    return Dispatcher.instance().read_alerts(req);
}


// EXPORTS
exports.new_tier_defaults = read_activity_log;
exports.new_policy_defaults = export_activity_log;
exports.get_unread_alerts_count = get_unread_alerts_count;
exports.mark_alerts_read = mark_alerts_read;
exports.read_alerts = read_alerts;
