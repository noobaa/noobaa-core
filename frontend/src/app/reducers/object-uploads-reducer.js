/* Copyright (C) 2016 NooBaa */

import { deepFreeze } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { OBJECT_UPLOAD_STARTED, OBJECT_UPLOAD_PROGRESS, OBJECT_UPLOAD_COMPLETED, OBJECT_UPLOAD_FAIELD,
    CLEAR_COPLETED_OBJECT_UPLOADES } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = deepFreeze({
    objects: [],
    lastUpload: {
        time: 0,
        objectCount: 0
    },
    stats: {
        count: 0,
        uploading: 0,
        uploaded: 0,
        failed: 0,
        batchSize: 0,
        batchLoaded: 0
    }
});

const initialObjectState = deepFreeze({
    id: '',
    name: '',
    bucket: '',
    size: 0,
    loaded: 0,
    completed: false,
    archived: false,
    error: ''
});

// ------------------------------
// Action Handlers
// ------------------------------
function onObjectUploadStarted(uploads, { time, objects }) {
    const newObjects = objects.map(
        ({ id, bucket, file }) => ({
            ...initialObjectState,
            id,
            bucket,
            name: file.name,
            size: file.size
        })
    );

    objects = [ ...uploads.objects, ...newObjects ];
    const stats = _recalcStats(objects);
    const lastUpload = {
        time: time,
        objectCount: newObjects.length
    };
    return { ...uploads, objects, lastUpload, stats };
}

function onObjectUploadProgress(uploads, { id, loaded }) {
    const objects = uploads.objects.map(
        obj => obj.id === id ? { ...obj, loaded } : obj
    );
    const stats = _recalcStats(objects);
    return { ...uploads, objects, stats };
}

function onObjectUploadCompleted(uploads, action) {
    return _completeUpload(uploads, action);
}

function onObjectUploadFailed(uploads, action) {
    return _completeUpload(uploads, action);
}

function onClearCompletedObjectUploads(uploads) {
    const objects = uploads.objects.filter(obj => !obj.completed);
    const stats = _recalcStats(objects);
    return { ...uploads, objects, stats };
}

// ------------------------------
// Local util functions
// ------------------------------
function _completeUpload(uploads, { id, error = '' }) {
    const objects = uploads.objects.map(
        obj => obj.id === id ? { ...obj, completed: true, error } : obj
    );

    const stats = _recalcStats(objects);

    if (stats.uploading === 0) {
        return {
            ...uploads,
            objects: objects.map(
                obj => ({ ...obj, archived: true })
            ),
            stats: {
                ...stats,
                batchSize: 0,
                batchLoaded: 0
            }
        };

    } else {
        return { ...uploads, objects, stats };
    }
}

function _recalcStats(objects) {
    return objects.reduce(
        (stats, obj) => {
            const { archived, completed, error } = obj;
            stats.count += 1;
            stats.uploading += Number(!completed);
            stats.failed += Number(completed && Boolean(error));
            stats.uploaded += Number(completed && !error);

            if (!archived) {
                const { size, loaded } = obj;
                stats.batchSize += size;
                stats.batchLoaded += loaded;
            }

            return stats;
        },
        Object.assign({}, initialState.stats)
    );
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [OBJECT_UPLOAD_STARTED]: onObjectUploadStarted,
    [OBJECT_UPLOAD_PROGRESS]: onObjectUploadProgress,
    [OBJECT_UPLOAD_COMPLETED]: onObjectUploadCompleted,
    [OBJECT_UPLOAD_FAIELD]: onObjectUploadFailed,
    [CLEAR_COPLETED_OBJECT_UPLOADES]: onClearCompletedObjectUploads
});
