/* Copyright (C) 2016 NooBaa */
'use strict';

var dotenv = require('../util/dotenv');
dotenv.load();

const _ = require('lodash');
const P = require('../util/promise');
const argv = require('minimist')(process.argv);
// const ObjectId = require('mongodb').ObjectID;
const Dispatcher = require('../server/notifications/dispatcher');
const db_client = require('../util/db_client');

const EXISTING_AUDIT_LOGS = {
    'node': ['create',
        'test_node',
        'decommission',
        'recommission',
        'connected',
        'disconnected'
    ],
    'obj': ['uploaded',
        'deleted'
    ],
    'bucket': ['create',
        'delete',
        'set_cloud_sync',
        'update_cloud_sync',
        'remove_cloud_sync',
        'edit_policy',
        's3_access_updated',
        'set_lifecycle_configuration_rules',
        'delete_lifecycle_configuration_rules'
    ],
    'account': ['create',
        'update',
        'delete',
        's3_access_updated',
        'generate_credentials'
    ],
    'resource': ['create',
        'delete',
        'cloud_create',
        'cloud_delete',
        'assign_nodes',
        'pool_assign_region',
        'cloud_assign_region'
    ],
    'dbg': ['set_debug_node',
        'diagnose_node',
        'diagnose_system',
        'diagnose_server',
        'set_debug_level',
        'set_server_debug_level',
        'maintenance_mode',
        'maintenance_mode_stopped'
    ],
    'cluster': ['added_member_to_cluster',
        'set_server_conf'
    ],
    'conf': ['create_system',
        'server_date_time_updated',
        'dns_address',
        'dns_servers',
        'upload_package',
        'system_upgrade_started',
        'system_after_completed'
    ]
};

const ALERTS_PRI = ['CRIT', 'MAJOR', 'INFO'];
const ALERTS_SAMPLES = [
    `The princess you are looking for is in another castle`,
    `Somebody's shoved a red-hot poker up our ass, and I want to know whose name is on the handle`,
    `Winter is coming`,
    `The problem is not the problem, the problem is your attitude about the problem`,
    `Scissors cuts paper, paper covers rock, rock crushes lizard, lizard poisons Spock, Spock smashes scissors, scissors decapitates lizard,
        lizard eats paper, paper disproves Spock, Spock vaporizes rock, and as it always has, rock crushes scissors`,
    `That's the second biggest monkey head I've ever seen!`,
    `Run you fools!`,
    `Not by height, technically. The measurement that we're looking for, really, is dick to floor. Call that D2F`,
    `Hell, it's about damn time`,
    `That’s What She Said`,
    `The cake is a lie`,
    `It seems today that all you see is violence in movies and sex on TV`
];

let sysid;
let has_nodes = false;
let has_objects = false;

const events = new EventsGenerator();

let entities = {
    bucket: {
        _id: ''
    },
    node: {
        _id: ''
    },
    obj: {
        _id: ''
    },
    account: {
        _id: ''
    },
    resource: {
        _id: ''
    },
    cluster: {
        hostname: '',
        secret: '',
    }
};

function EventsGenerator() {
    //
}

EventsGenerator.prototype.init = function() {
    const fields = { _id: 1 };
    //Init all ObjectIDs of the entities in the system, ndoes and objects don't have to exist
    return db_client.instance().connect()
        .then(() => db_client.instance().collection('systems').findOne({}, { projection: fields }))
        .then(res => {
            if (res) {
                sysid = res._id;
                return db_client.instance().collection('buckets').findOne({}, { projection: fields });
            } else {
                console.info('No system, aborting...');
                process.exit(0);
            }
        })
        .then(bucket => {
            entities.bucket._id = bucket._id;
            return db_client.instance().collection('accounts').findOne({}, { projection: fields });
        })
        .then(account => {
            entities.account._id = account._id;
            return db_client.instance().collection('pools').findOne({}, { projection: fields });
        })
        .then(pool => {
            entities.resource._id = pool._id;
            return db_client.instance().collection('clusters').findOne({});
        })
        .then(cluster => {
            entities.cluster.hostname = cluster.heartbeat.health.os_info.hostname;
            entities.cluster.secret = cluster.owner_secret;
            return db_client.instance().collection('nodes').findOne({}, { projection: fields });
        })
        .then(node => {
            if (node) {
                entities.node._id = node._id;
                has_nodes = true;
            } else {
                delete entities.node;
            }
            return db_client.instance().collection('objectmds').findOne({}, { projection: fields });
        })
        .then(obj => {
            if (obj) {
                entities.obj._id = obj._id;
                has_objects = true;
            } else {
                delete entities.obj;
            }
            console.warn('Initiated with', entities);
        });
};

EventsGenerator.prototype.generate_alerts = function(num, pri) {
    let priorites = [];
    if (pri === 'ALL') {
        priorites = ALERTS_PRI;
    } else {
        if (!ALERTS_PRI.find(function(p) {
                return p === pri;
            })) {
            console.warn('No such priority', pri);
            events.print_usage();
        }
        priorites = [pri];
    }

    const pri_size = priorites.length;
    const alerts_size = ALERTS_SAMPLES.length;
    let count = 0;
    return P.pwhile(() => count < num,
        () => {
            count += 1;
            const alchosen = Math.floor(Math.random() * (alerts_size));
            const prichosen = Math.floor(Math.random() * (pri_size));
            return P.resolve()
                .then(() => Dispatcher.instance().alert(priorites[prichosen],
                    sysid,
                    ALERTS_SAMPLES[alchosen]))
                .then(() => P.delay(1000));
        });
};

EventsGenerator.prototype.generate_audit = function(num, cat) {
    let events_pool = [];
    if (cat === 'ALL') {
        _.map(_.keys(EXISTING_AUDIT_LOGS), c => {
            //Skip nodes / objects if no entities exist
            if (c === 'node' && !has_nodes) {
                console.warn('Skipping nodes, no nodes exist');
                return;
            } else if (c === 'obj' && !has_objects) {
                console.warn('Skipping objects, no objects exist');
                return;
            }
            //Update entity ID/name for later audit generation
            let ent = events._get_entity(c);
            events_pool.concat(_.map(EXISTING_AUDIT_LOGS[c], function(ev) {
                events_pool.push(_.defaults({
                    level: 'info',
                    event: c + '.' + ev,
                    system: sysid,
                    desc: 'Dummy log created by the events generator',
                }, ent));
            }));
        });
    } else {
        if (!EXISTING_AUDIT_LOGS[cat]) {
            console.warn('No such category', cat);
            events.print_usage();
        }
        _.map(EXISTING_AUDIT_LOGS[cat], function(ev) {
            let ent = events._get_entity(cat);
            events_pool.push(_.defaults({
                level: 'info',
                event: cat + '.' + ev,
                system: sysid,
                desc: 'Dummy log created by the events generator',
            }, ent));
        });
    }

    const logs_size = events_pool.length;
    let count = 0;
    return P.pwhile(() => count < num,
        () => {
            count += 1;
            const chosen = Math.floor(Math.random() * (logs_size));
            return P.resolve()
                .then(() => Dispatcher.instance().activity(_.clone(events_pool[chosen])))
                .then(() => P.delay(1000));
        });
};
EventsGenerator.prototype.send_alert = function(alert, sev, rule) {
    return P.resolve()
        .then(() => {
            if (rule) {
                if (!Dispatcher.rules[rule]) {
                    console.warn('No such rule implemented', rule);
                    process.exit(1);
                }
                return Dispatcher.instance().alert(sev,
                    sysid,
                    alert,
                    Dispatcher.rules[rule]
                );
            } else {
                return Dispatcher.instance().alert(sev,
                    sysid,
                    alert
                );
            }
        })
        .then(() => P.delay(500));
};

EventsGenerator.prototype.print_usage = function() {
    console.info('Events and Alerts Generator');
    console.info('\t--help\t\tShow this help message\n');
    console.info('\t--audit\t\tGenerate random audit logs');
    console.info('\t\t\t--adnum number of logs, default is 10');
    console.info('\t\t\t--adcat <node/obj/bucket/account/resource/dbg/cluster/conf/ALL>, default is ALL\n');
    console.info('\t--alert\t\tGenerate random alerts');
    console.info('\t\t\t--alnum number of alerts, default is 10');
    console.info('\t\t\t--alpri <CRIT/MAJOR/INFO/ALL>, default is ALL\n');
    console.info('\t--sendalert\tSend an alert to the dispatcher --msg <text> --sev <severity> [--rule suppression_rule_name]');
    process.exit(0);
};

EventsGenerator.prototype._get_entity = function(c) {
    let ent = {};
    switch (c) {
        case 'bucket':
            ent = { bucket: entities.bucket._id };
            break;
        case 'node':
            ent = { node: entities.node._id };
            break;
        case 'obj':
            ent = { obj: entities.obj._id };
            break;
        case 'account':
            ent = { account: entities.account._id };
            break;
        case 'resource':
            ent = { resource: entities.resource._id };
            break;
        case 'server':
            ent = {
                server: {
                    hostname: entities.cluster.hostname,
                    secret: entities.cluster.secret
                }
            };
            break;
        default:
            break;
    }
    return ent;
};

function main() {
    if (argv.help) {
        events.print_usage();
    }
    return events.init()
        .then(() => {
            if (argv.audit) {
                //Verify category is not nodes/objects when there are non
                if (argv.adcat && argv.adcat.toString() === 'node' && !has_nodes) {
                    console.error('Selected category nodes while no nodes exist');
                    events.print_usage();
                } else if (argv.adcat && argv.adcat.toString() === 'obj' && !has_objects) {
                    console.error('Selected category obj while no objects exist');
                    events.print_usage();
                }
                return events.generate_audit(argv.adnum ? argv.adnum : 10,
                    argv.adcat ? argv.adcat.toString() : 'ALL');
            }
            if (argv.alert) {
                return events.generate_alerts(argv.alnum ? argv.alnum : 10,
                    argv.alpri ? argv.alpri.toString() : 'ALL');
            }
            if (argv.sendalert) {
                return events.send_alert(argv.msg, argv.sev, argv.rule);
            }
        })
        .then(() => process.exit(0));
}

if (require.main === module) {
    main();
}
