import {
     FETCH_CLOUD_TARGETS,
     COMPLETE_FETCH_CLOUD_TARGETS,
     FAIL_FETCH_CLOUD_TARGETS,
     DROP_CLOUD_TARGETS
} from 'action-types';


export function fetchCloudTargets(connection) {
    return {
        type: FETCH_CLOUD_TARGETS,
        payload: { connection }
    };
}

export function completeFetchCloudTargets(connection, targets) {
    return {
        type: COMPLETE_FETCH_CLOUD_TARGETS,
        payload: { connection, targets }
    };
}

export function failFetchCloudTargets(connection, error) {
    return {
        type: FAIL_FETCH_CLOUD_TARGETS,
        payload: { connection, error }
    };
}

export function dropCloudTargets(){
    return { type: DROP_CLOUD_TARGETS };
}
