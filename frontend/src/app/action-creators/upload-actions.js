/* Copyright (C) 2016 NooBaa */

import { randomString } from 'utils/string-utils';
import {
    UPLOAD_OBJECTS,
    FAIL_OBJECT_UPLOAD,
    COMPLETE_OBJECT_UPLOAD,
    COMPLETE_OBJECTS_UPLOAD,
    UPDATE_OBJECT_UPLOAD,
    CLEAR_COMPLETED_OBJECT_UPLOADES
} from 'action-types';

export function uploadObjects(bucket, files, connection) {
    const time = Date.now();
    const objects = Array.from(files).map(file => ({
        id: randomString(),
        bucket,
        file
    }));

    return {
        type: UPLOAD_OBJECTS,
        payload: { objects, time, connection }
    };
}

export function updateObjectUpload(id, loaded) {
    return {
        type: UPDATE_OBJECT_UPLOAD,
        payload: { id, loaded }
    };
}

export function completeObjectUpload(id) {
    return {
        type: COMPLETE_OBJECT_UPLOAD,
        payload: { id }
    };
}

export function failObjectUpload(id, name, error) {
    return {
        type: FAIL_OBJECT_UPLOAD,
        payload: { id, name, error }
    };
}

export function completeObjectsUpload(successCount) {
    return {
        type: COMPLETE_OBJECTS_UPLOAD,
        payload: { successCount }
    };
}

export function clearCompletedObjectUploads() {
    return { type: CLEAR_COMPLETED_OBJECT_UPLOADES };
}
