import { deepFreeze } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';

const initialState = deepFreeze({
    requests: [],
    stats: {
        count: 0,
        uploading: 0,
        uploaded: 0,
        failed: 0,
        batchSize: 0,
        batchLoaded: 0
    }
});

const initialRequestState = deepFreeze({
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
function onApplicationInit() {
    return initialState;
}

function onObjectUploadStarted(uploads, { id, bucket, file, time }) {
    const request = {
        ...initialRequestState,
        id: id,
        name: file.name,
        bucket: bucket,
        size: file.size,
        time: time
    };

    const requests = [ ...uploads.requests, request ];
    const stats = _recalcStats(requests);
    return { requests, stats };
}

function onObjectUploadProgress(uploads, { id, loaded }) {
    const requests = uploads.requests.map(
        req => req.id === id ? { ...req, loaded } : req
    );
    const stats = _recalcStats(requests);
    return { ...uploads, requests, stats };
}

function onObjectUploadCompleted(uploads, action) {
    return _completeUpload(uploads, action);
}

function onObjectUploadFailed(uploads, action) {
    return _completeUpload(uploads, action);
}

function onClearCompletedObjectUploads(uploads) {
    const requests = uploads.requests.filter(
        req => !req.completed
    );
    const stats = _recalcStats(requests);
    return { ...uploads, requests, stats };
}

// ------------------------------
// Local util functions
// ------------------------------
function _completeUpload(uploads, { id, error = '' }) {
    const requests = uploads.requests.map(
        req => req.id === id ? { ...req, completed: true, error } : req
    );

    const stats = _recalcStats(requests);

    if (stats.uploading === 0) {
        return {
            ...uploads,
            requests: requests.map(
                req => ({ ...req, archived: true })
            ),
            stats: {
                ...stats,
                batchSize: 0,
                batchLoaded: 0
            }
        };

    } else {
        return { ...uploads, requests, stats };
    }
}

function _recalcStats(requests) {
    return requests.reduce(
        (stats, req) => {
            const { archived, completed, error } = req;
            stats.count += 1;
            stats.uploading += Number(!completed);
            stats.failed += Number(completed && Boolean(error));
            stats.uploaded += Number(completed && !error);

            if (!archived) {
                const { size, loaded } = req;
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
export default createReducer({
    APPLICATION_INIT: onApplicationInit,
    OBJECT_UPLOAD_STARTED: onObjectUploadStarted,
    OBJECT_UPLOAD_PROGRESS: onObjectUploadProgress,
    OBJECT_UPLOAD_COMPLETED: onObjectUploadCompleted,
    OBJECT_UPLOAD_FAIELD: onObjectUploadFailed,
    CLEAR_COPLETED_OBJECT_UPLOADES: onClearCompletedObjectUploads
});
