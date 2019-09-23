/* Copyright (C) 2016 NooBaa */

import {
    FETCH_AUDIT_LOG,
    COMPLETE_FETCH_AUDIT_LOG,
    FAIL_FETCH_AUDIT_LOG,
    DROP_AUDIT_LOG,
    EXPORT_AUDIT_LOG,
    COMPLETE_EXPORT_AUDIT_LOG,
    FAIL_EXPORT_AUDIT_LOG,
    SELECT_AUDIT_RECORD
} from 'action-types';

export function fetchAuditLog(query, limit, till) {
    return {
        type: FETCH_AUDIT_LOG,
        payload: { query, limit, till }
    };
}

export function completeFetchAuditLog(requested, list) {
    return {
        type: COMPLETE_FETCH_AUDIT_LOG,
        payload: { requested, list }
    };
}

export function failFetchAuditLog(error) {
    return {
        type: FAIL_FETCH_AUDIT_LOG,
        payload: { error }
    };
}

export function dropAuditLog() {
    return { type: DROP_AUDIT_LOG };
}

export function exportAuditLog(categories) {
    return {
        type: EXPORT_AUDIT_LOG,
        payload: { categories }
    };
}

export function completeExportAuditLog(logUri) {
    return {
        type: COMPLETE_EXPORT_AUDIT_LOG,
        payload: { logUri }
    };
}

export function failExportAuditLog(error) {
    return {
        type: FAIL_EXPORT_AUDIT_LOG,
        payload: { error }
    };
}

export function selectAuditRecord(recordId) {
    return {
        type: SELECT_AUDIT_RECORD,
        payload: { recordId }
    };
}
