/* Copyright (C) 2016 NooBaa */

import {
    FETCH_BUCKET_USAGE_HISTORY,
    COMPLETE_FETCH_BUCKET_USAGE_HISTORY,
    FAIL_FETCH_BUCKET_USAGE_HISTORY,
    DROP_BUCKET_USAGE_HISTORY,
    FETCH_ACCOUNT_USAGE_HISTORY,
    COMPLETE_FETCH_ACCOUNT_USAGE_HISTORY,
    FAIL_FETCH_ACCOUNT_USAGE_HISTORY,
    DROP_ACCOUNT_USAGE_HISTORY,
    FETCH_OBJECTS_DISTRIBUTION,
    COMPLETE_FETCH_OBJECTS_DISTRIBUTION,
    FAIL_FETCH_OBJECTS_DISTRIBUTION,
    DROP_FETCH_OBJECTS_DISTRIBUTION,
    FETCH_CLOUD_USAGE_STATS,
    COMPLETE_FETCH_CLOUD_USAGE_STATS,
    FAIL_FETCH_CLOUD_USAGE_STATS,
    DROP_CLOUD_USAGE_STATS
} from 'action-types';

export function fetchBucketUsageHistory(buckets, duration) {
    return {
        type: FETCH_BUCKET_USAGE_HISTORY,
        payload: { buckets, duration }
    };
}

export function completeFetchBucketUsageHistory(query, usage) {
    return {
        type: COMPLETE_FETCH_BUCKET_USAGE_HISTORY,
        payload: { query, usage }
    };
}

export function failFetchBucketUsageHistory(query, error) {
    return {
        type: FAIL_FETCH_BUCKET_USAGE_HISTORY,
        payload: { query, error }
    };
}

export function dropBucketUsageHistory() {
    return { type: DROP_BUCKET_USAGE_HISTORY };
}

export function fetchAccountUsageHistory(accounts, duration) {
    return {
        type: FETCH_ACCOUNT_USAGE_HISTORY,
        payload: { accounts, duration }
    };
}

export function completeFetchAccountUsageHistory(query, usage) {
    return {
        type: COMPLETE_FETCH_ACCOUNT_USAGE_HISTORY,
        payload: { query, usage }
    };
}

export function failFetchAccountUsageHistory(query, error) {
    return {
        type: FAIL_FETCH_ACCOUNT_USAGE_HISTORY,
        payload: { query, error }
    };
}

export function dropAccountUsageHistory() {
    return { type: DROP_ACCOUNT_USAGE_HISTORY };
}

export function fetchObjectsDistribution() {
    return { type: FETCH_OBJECTS_DISTRIBUTION };
}

export function completeFetchObjectsDistribution(distribution) {
    return {
        type: COMPLETE_FETCH_OBJECTS_DISTRIBUTION,
        payload: distribution
    };
}

export function failCompleteFetchObjectsDistribution(error) {
    return {
        type: FAIL_FETCH_OBJECTS_DISTRIBUTION,
        payload: { error }
    };
}

export function dropCompleteFetchObjectsDistribution() {
    return { type: DROP_FETCH_OBJECTS_DISTRIBUTION };
}

export function fetchCloudUsageStats(duration) {
    return {
        type: FETCH_CLOUD_USAGE_STATS,
        payload: { duration }
    };
}

export function completeFetchCloudUsageStats(query, usage) {
    return {
        type: COMPLETE_FETCH_CLOUD_USAGE_STATS,
        payload: { query, usage }
    };
}

export function failFetchCloudUsageStats(query, error) {
    return {
        type: FAIL_FETCH_CLOUD_USAGE_STATS,
        payload: { query, error }
    };
}

export function dropCloudUsageStats() {
    return { type: DROP_CLOUD_USAGE_STATS };
}
