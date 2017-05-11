/* Copyright (C) 2016 NooBaa */
'use strict';

var dotenv = require('../util/dotenv');
dotenv.load();

const _ = require('lodash');
const P = require('../util/promise');
const argv = require('minimist')(process.argv);
const ObjectId = require('mongodb').ObjectID;
const Dispatcher = require('../server/notifications/dispatcher');
const mongo_client = require('../util/mongo_client');
const promise_utils = require('../util/promise_utils');

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
        'assign_nodes'
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
    'config': ['create_system',
        'server_date_time_updated',
        'dns_address',
        'set_phone_home_proxy_address',
        'dns_servers',
        'remote_syslog',
        'set_certificate'
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
    //Init all ObjectIDs of the entities in the system, ndoes and objects don't have to exist
    return promise_utils.exec('mongo nbcore --eval "db.systems.findOne({},{_id:1})" --quiet | grep _id', false, true)
        .then(res => {
            const location = res.indexOf('Obj') + 10;
            sysid = ObjectId(res.substring(location, location + 24));
            return promise_utils.exec('mongo nbcore --eval "db.buckets.findOne({},{_id:1})" --quiet | grep _id', false, true);
        })
        .then(bucket => {
            const location = bucket.indexOf('Obj') + 10;
            entities.bucket._id = ObjectId(bucket.substring(location, location + 24));
            return promise_utils.exec('mongo nbcore --eval "db.accounts.findOne({},{_id:1})" --quiet | grep _id', false, true);
        })
        .then(account => {
            const location = account.indexOf('Obj') + 10;
            entities.account._id = ObjectId(account.substring(location, location + 24));
            return promise_utils.exec('mongo nbcore --eval "db.pools.findOne({},{_id:1})" --quiet | grep _id', false, true);
        })
        .then(pool => {
            const location = pool.indexOf('Obj') + 10;
            entities.resource._id = ObjectId(pool.substring(location, location + 24));
            return promise_utils.exec('mongo nbcore --eval "db.clusters.findOne({})" --quiet | grep hostname', false, true);
        })
        .then(hostname => {
            const location = hostname.indexOf(':') + 3;
            entities.cluster.hostname = hostname.substring(location, hostname.length - 3);
            return promise_utils.exec('mongo nbcore --eval "db.clusters.findOne({})" --quiet | grep owner_secret', false, true);
        })
        .then(secret => {
            const location = secret.indexOf(':') + 3;
            entities.cluster.secret = secret.substring(location, secret.length - 3);
            return promise_utils.exec('mongo nbcore --eval "db.nodes.findOne({},{_id:1})" --quiet | grep _id', true, true);
        })
        .then(node => {
            if (node) {
                const location = node.indexOf('Obj') + 10;
                entities.node._id = ObjectId(node.substring(location, location + 24));
                has_nodes = true;
            } else {
                delete entities.node;
            }
            return promise_utils.exec('mongo nbcore --eval "db.objectmds.findOne({},{_id:1})" --quiet | grep _id', true, true);
        })
        .then(obj => {
            if (obj) {
                const location = obj.indexOf('Obj') + 10;
                entities.obj._id = ObjectId(obj.substring(location, location + 24));
                has_objects = true;
            } else {
                delete entities.obj;
            }
            console.warn('Initiated with', entities);
        })
        .then(() => mongo_client.instance().connect());
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
    return promise_utils.pwhile(() => count < num,
        () => {
            count += 1;
            const alchosen = Math.floor(Math.random() * (alerts_size));
            const prichosen = Math.floor(Math.random() * (pri_size));
            return P.resolve()
                .then(() => Dispatcher.instance().alert(priorites[prichosen],
                    sysid,
                    ALERTS_SAMPLES[alchosen]))
                .delay(1000);
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
    return promise_utils.pwhile(() => count < num,
        () => {
            count += 1;
            const chosen = Math.floor(Math.random() * (logs_size));
            return P.resolve()
                .then(() => console.warn('NBNB:: Audit', events_pool[chosen]))
                .then(() => Dispatcher.instance().activity(events_pool[chosen]))
                .delay(1000);
        });
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
        })
        .then(() => process.exit(0));
}

if (require.main === module) {
    main();
}
