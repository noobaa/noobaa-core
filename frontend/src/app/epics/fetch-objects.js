/* Copyright (C) 2016 NooBaa */

import { FETCH_OBJECTS } from 'action-types';
import { completeFetchObjects, failFetchObjects } from 'action-creators';

async function _fetchSingleObject(api, query, s3Endpoint) {
    const objects = [
        await api.object.read_object_md({
            bucket :query.bucket,
            key: query.object,
            adminfo: {
                signed_url_endpoint: s3Endpoint
            }
        })
    ];

    // Mock counters for single object read.
    const counters = {
        non_paginated: 1,
        by_mode: {
            completed: 1,
            uploading: 0
        }
    };

    return { objects, counters };
}

async function _fetchObjectList(api, query, s3Endpoint) {
    const { bucket, filter, sortBy, order, skip, limit, stateFilter } = query;

    let uploadMode;
    if (stateFilter !== 'ALL') uploadMode = false;
    if (stateFilter === 'UPLOADING') uploadMode = true;

    return await api.object.list_objects({
        bucket,
        key_query: filter,
        sort: sortBy,
        order,
        skip,
        limit,
        pagination: true,
        upload_mode: uploadMode,
        adminfo: {
            signed_url_endpoint: s3Endpoint
        }
    });
}

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_OBJECTS)
        .flatMap(async action => {
            const { query, s3Endpoint } = action.payload;

            try {
                const response = query.object ?
                    await _fetchSingleObject(api, query, s3Endpoint) :
                    await _fetchObjectList(api, query, s3Endpoint);

                return completeFetchObjects(query, response);

            } catch (error) {
                return failFetchObjects(query, error);
            }

        });
}


