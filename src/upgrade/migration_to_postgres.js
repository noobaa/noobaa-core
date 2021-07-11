/* Copyright (C) 2016 NooBaa */
'use strict';

const system_schema = require('../server/system_services/schemas/system_schema');
const cluster_schema = require('../server/system_services/schemas/cluster_schema');
const namespace_resource_schema = require('../server/system_services/schemas/namespace_resource_schema');
const role_schema = require('../server/system_services/schemas/role_schema');
const account_schema = require('../server/system_services/schemas/account_schema');
const bucket_schema = require('../server/system_services/schemas/bucket_schema');
const tiering_policy_schema = require('../server/system_services/schemas/tiering_policy_schema');
const tier_schema = require('../server/system_services/schemas/tier_schema');
const pool_schema = require('../server/system_services/schemas/pool_schema');
const agent_config_schema = require('../server/system_services/schemas/agent_config_schema');
const chunk_config_schema = require('../server/system_services/schemas/chunk_config_schema');
const master_key_schema = require('../server/system_services/schemas/master_key_schema');
const object_md_schema = require('../server/object_services/schemas/object_md_schema');
const object_multipart_schema = require('../server/object_services/schemas/object_multipart_schema');
const object_part_schema = require('../server/object_services/schemas/object_part_schema');
const data_chunk_schema = require('../server/object_services/schemas/data_chunk_schema');
const data_block_schema = require('../server/object_services/schemas/data_block_schema');
const object_md_indexes = require('../server/object_services/schemas/object_md_indexes');
const object_multipart_indexes = require('../server/object_services/schemas/object_multipart_indexes');
const object_part_indexes = require('../server/object_services/schemas/object_part_indexes');
const data_chunk_indexes = require('../server/object_services/schemas/data_chunk_indexes');
const data_block_indexes = require('../server/object_services/schemas/data_block_indexes');
const node_schema = require('../server/node_services/node_schema');
const func_schema = require('../server/func_services/func_schema');
const func_stats_schema = require('../server/func_services/func_stats_schema');
const bucket_stats_schema = require('../server/analytic_services/bucket_stats_schema');
const endpoint_group_report_schema = require('../server/analytic_services/endpoint_group_report_schema');
const s3_usage_schema = require('../server/analytic_services/s3_usage_schema');
const usage_report_schema = require('../server/analytic_services/usage_report_schema');
const io_stats_schema = require('../server/analytic_services/io_stats_schema');
const system_history_schema = require('../server/analytic_services/system_history_schema');
const activity_log_schema = require('../server/analytic_services/activity_log_schema');
const alerts_log_schema = require('../server/notifications/alerts_log_schema');


const postgres_client = require('../util/postgres_client');
const mongo_client = require('../util/mongo_client');

const { Migrator } = require('./migrator');

const name_deleted_indexes = [{
    fields: {
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
        }
    }
}];

const system_name_deleted_indexes = [{
    fields: {
        system: 1,
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
        }
    }
}];

const COLLECTIONS = [{
    name: 'clusters', // system_store
    schema: cluster_schema,
    db_indexes: [{
        fields: {
            owner_secret: 1,
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'namespace_resources',
    schema: namespace_resource_schema,
    db_indexes: name_deleted_indexes,
}, {
    name: 'systems',
    schema: system_schema,
    db_indexes: name_deleted_indexes,
}, {
    name: 'roles',
    schema: role_schema,
    db_indexes: [],
}, {
    name: 'accounts',
    schema: account_schema,
    db_indexes: [{
        fields: {
            email: 1,
        },
        options: {
            unique: true,
            partialFilterExpression: {
                deleted: null,
            }
        }
    }],
}, {
    name: 'buckets',
    schema: bucket_schema,
    db_indexes: system_name_deleted_indexes,
}, {
    name: 'tieringpolicies',
    schema: tiering_policy_schema,
    db_indexes: system_name_deleted_indexes,
}, {
    name: 'tiers',
    schema: tier_schema,
    db_indexes: system_name_deleted_indexes,
}, {
    name: 'pools',
    schema: pool_schema,
    db_indexes: system_name_deleted_indexes,
}, {
    name: 'agent_configs',
    schema: agent_config_schema,
    db_indexes: [{
        fields: {
            system: 1,
            name: 1
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'chunk_configs',
    schema: chunk_config_schema,
}, {
    name: 'master_keys',
    schema: master_key_schema,
}, {
    name: 'objectmds', // md_store
    schema: object_md_schema,
    db_indexes: object_md_indexes,
}, {
    name: 'objectmultiparts',
    schema: object_multipart_schema,
    db_indexes: object_multipart_indexes,
}, {
    name: 'objectparts',
    schema: object_part_schema,
    db_indexes: object_part_indexes,
}, {
    name: 'datachunks',
    schema: data_chunk_schema,
    db_indexes: data_chunk_indexes,
}, {
    name: 'datablocks',
    schema: data_block_schema,
    db_indexes: data_block_indexes,
}, {
    name: 'mdsequences',
}, { // nodes_store
    name: 'nodes',
    schema: node_schema,
}, { // func_store
    name: 'funcs',
    schema: func_schema,
    db_indexes: [{
        fields: {
            system: 1,
            name: 1,
            version: 1,
            deleted: 1,
        },
        options: {
            unique: true,
        }
    }]
}, { // bucket_stats_store
    name: 'bucketstats',
    schema: bucket_stats_schema,
    db_indexes: [{
        fields: {
            bucket: 1
        }
    }],
}, { // endpoint_stats_store
    name: 'objectstats',
    schema: s3_usage_schema,
    db_indexes: [{
        fields: {
            system: 1,
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'usagereports',
    schema: usage_report_schema,
    db_indexes: [{
        fields: {
            start_time: 1,
            aggregated_time: -1,
            aggregated_time_range: 1,
        }
    }],
}, {
    name: 'endpointgroupreports',
    schema: endpoint_group_report_schema,
    db_indexes: [{
        fields: {
            start_time: 1,
            aggregated_time: -1,
            aggregated_time_range: 1,
        }
    }]
}, { // io_stats_store
    name: 'iostats',
    schema: io_stats_schema,
    db_indexes: [{
        fields: {
            system: 1,
            resource_id: 1,
            resource_type: 1,
            start_time: 1,
            end_time: 1
        }
    }],
}, { // func_stats_store
    name: 'func_stats',
    schema: func_stats_schema,
    db_indexes: [{
        fields: {
            system: 1,
            id: 1,
            latency_ms: 1,
        }
    }]
}, { // activity_log_store
    name: 'activitylogs',
    schema: activity_log_schema,
    db_indexes: [{
        fields: {
            time: 1,
        },
        options: {
            unique: false,
        }
    }]
}, { // alerts_log_store
    name: 'alertslogs',
    schema: alerts_log_schema,
    db_indexes: []
}, { // history_data_store
    name: 'system_history',
    schema: system_history_schema,
}];

async function main() {
    try {
        const from_client = mongo_client.instance();
        const to_client = postgres_client.instance();
        // await to_client.dropDatabase();
        // await to_client.createDatabase();
        const migrator = new Migrator(from_client, to_client, COLLECTIONS);
        await migrator.migrate_db();
    } catch (err) {
        console.log('ERROR in merging', err);
        process.exit(1);
    }
    process.exit(0);
}


main();
