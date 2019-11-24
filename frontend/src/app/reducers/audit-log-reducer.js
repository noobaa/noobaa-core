/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import {
    FETCH_AUDIT_LOG,
    COMPLETE_FETCH_AUDIT_LOG,
    FAIL_FETCH_AUDIT_LOG,
    DROP_AUDIT_LOG,
    SELECT_AUDIT_RECORD
} from 'action-types';

// ------------------------------
// Initial state
// ------------------------------
const initialState = {
    loading: 0,
    loadError: null,
    categories: [],
    list: [],
    endOfList: false,
    selectedRecord: ''
};

// ------------------------------
// Action Handlers
// ------------------------------

function onFetchAuditLog(state, { payload }) {
    const categories = [...payload.query.categories].sort();
    if (categories.toString() === state.categories.toString()) {
        return {
            ...state,
            loading: state.loading + 1,
            loadError: null
        };

    } else {
        return {
            ...initialState,
            categories,
            loading: state.loading + 1
        };
    }
}

function onCompleteFetchAuditLog(state, { payload }) {
    if (state.loading > 1) {
        return {
            ...state,
            loading: state.loading - 1
        };

    } else {
        const { requested, list } = payload;
        const endOfList = list.length < requested;
        return {
            ...state,
            endOfList,
            loading: 0,
            list: [
                ...state.list,
                ...list.map(_mapAuditRecord)
            ]
        };
    }
}

function onFailFetchAuditLog(state, { payload }) {
    if (state.loading > 1) {
        return {
            ...state,
            loading: state.loading - 1
        };

    } else {
        return {
            ...state,
            loading: 0,
            loadError: payload.error.message
        };
    }
}

function onDropAuditLog() {
    return initialState;
}

function onSelectAuditRecord(state, { payload }) {
    const { recordId } = payload;
    if (state.list.every(record => record.id !== recordId)) {
        return state;
    }

    return {
        ...state,
        selectedRecord: recordId
    };
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapAuditRecord(record) {
    const { id, time, actor } = record;
    const [ category, event ] = record.event.split('.');
    const desc = record.desc
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n');

    return {
        id,
        time,
        actor: actor && {
            name: actor.email,
            linkable: actor.linkable
        },
        category,
        event,
        entity: _getEntity(record),
        desc
    };
}

function _getEntity(record) {
    switch (record.event) {
        case 'node.create':
        case 'node.test_node':
        case 'node.decommission':
        case 'node.storage_disabled':
        case 'node.storage_enabled':
        case 'node.edit_drives':
        case 'node.endpoint_disabled':
        case 'node.endpoint_enabled':
        case 'node.recommission':
        case 'node.connected':
        case 'node.deleted':
        case 'node.delete_started':
        case 'node.untrusted':
        case 'node.retrust':
        case 'node.disconnected':
        case 'dbg.set_debug_node': {
            if (!record.node) {
                return;
            }

            const { name, pool, linkable } = record.node;
            return {
                kind: 'node',
                linkable,
                name,
                pool
            };
        }

        case 'obj.uploaded':
        case 'obj.deleted': {
            if (!record.obj) {
                return;
            }

            const { key, version, bucket, linkable } = record.obj;
            return {
                kind: 'object',
                linkable,
                key,
                version,
                bucket
            };
        }

        case 'bucket.create':
        case 'bucket.delete':
        case 'bucket.set_cloud_sync':
        case 'bucket.update_cloud_sync':
        case 'bucket.remove_cloud_sync':
        case 'bucket.edit_policy':
        case 'bucket.edit_resiliency':
        case 'bucket.s3_access_updated':
        case 'bucket.set_lifecycle_configuration_rules':
        case 'bucket.quota':
        case 'bucket.versioning':
        case 'bucket.delete_lifecycle_configuration_rules': {
            if (!record.bucket) {
                return;
            }

            const { linkable, name } = record.bucket;
            return {
                kind: 'bucket',
                linkable,
                name
            };
        }
        case 'account.create':
        case 'account.update':
        case 'account.delete':
        case 'account.s3_access_updated':
        case 'account.generate_credentials':
        case 'account.connection_create':
        case 'account.connection_delete': {
            if (!record.account) {
                return;
            }

            const { linkable, email } = record.account;
            return {
                kind: 'account',
                linkable,
                name: email
            };
        }

        case 'resource.create':
        case 'resource.delete':
        case 'resource.cloud_create':
        case 'resource.cloud_delete':
        case 'resource.assign_nodes':
        case 'resource.pool_assign_region':
        case 'resource.cloud_assign_region':
        case 'resource.scale': {
            if (!record.pool) {
                return;
            }

            const { linkable, name, resource_type } = record.pool;
            return {
                kind: 'resource',
                linkable,
                name,
                resourceType: resource_type
            };
        }

        case 'dbg.diagnose_server':
        case 'dbg.set_server_debug_level':
        case 'cluster.added_member_to_cluster':
        case 'cluster.set_server_conf': {
            const { hostname, secret } = record.server;
            if (!hostname || !secret) {
                return;
            }

            return {
                kind: 'server',
                linkable: true,
                name: `${hostname}-${secret}`
            };
        }

        case 'functions.func_created':
        case 'functions.func_config_edit':
        case 'functions.func_code_edit': {
            if (!record.func) {
                return;
            }

            const { linkable, name } = record.func;
            return {
                kind: 'function',
                linkable,
                name
            };
        }

        default: {
            return;
        }
    }
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer(initialState, {
    [FETCH_AUDIT_LOG]: onFetchAuditLog,
    [COMPLETE_FETCH_AUDIT_LOG]: onCompleteFetchAuditLog,
    [FAIL_FETCH_AUDIT_LOG]: onFailFetchAuditLog,
    [DROP_AUDIT_LOG]: onDropAuditLog,
    [SELECT_AUDIT_RECORD]: onSelectAuditRecord
});
