/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state-actions';
import api from 'services/api';
import { all, sleep } from 'utils/promise-utils';
import { SYSTEM_INFO_FETCHED, NODE_INSTALLATION_COMMANDS_FETCHED, UPGRADE_SYSTEM,
    CREATE_ACCOUNT,  ACCOUNT_CREATED, ACCOUNT_CREATION_FAILED, UPDATE_ACCOUNT_S3_ACCESS,
    ACCOUNT_S3_ACCESS_UPDATED, ACCOUNT_S3_ACCESS_UPDATE_FAILED } from 'action-types';

export async function fetchSystemInfo() {
    const info = await api.system.read_system();
    dispatch({ type: SYSTEM_INFO_FETCHED, info });
}

export async function fetchNodeInstallationCommands(targetPool, excludedDrives) {
    const commands = await api.system.get_node_installation_string({
        pool: targetPool,
        exclude_drives: excludedDrives
    });

    dispatch({
        type: NODE_INSTALLATION_COMMANDS_FETCHED,
        targetPool, excludedDrives, commands
    });
}

export async function upgradeSystem() {
    dispatch({ type: UPGRADE_SYSTEM });
    // REFACTOR: move the actual upgrade process from actions.js to here.
}


export async function createAccount(email, password, s3Access, defaultResource, allowedBuckets) {
    dispatch({
        type: CREATE_ACCOUNT,
        email, password, s3Access, defaultResource, allowedBuckets
    });

    try {
        await all(
            api.account.create_account({
                name: email.split('@')[0],
                email: email,
                password: password,
                must_change_password: true,
                s3_access: s3Access,
                default_pool: s3Access ? defaultResource : undefined,
                allowed_buckets: s3Access ? allowedBuckets : undefined
            }),
            sleep(750)
        );

        dispatch({ type: ACCOUNT_CREATED, email });

    } catch (error) {
        dispatch({ type: ACCOUNT_CREATION_FAILED, email, error });
    }
}

export async function updateAccountS3Access(email, s3Access, defaultResource, allowedBuckets) {
    dispatch({
        type: UPDATE_ACCOUNT_S3_ACCESS,
        email, s3Access, defaultResource, allowedBuckets
    });

    try {
        await api.account.update_account_s3_access({
            email: email,
            s3_access: s3Access,
            default_pool: s3Access ? defaultResource : undefined,
            allowed_buckets: s3Access ? allowedBuckets : undefined
        });

        dispatch({ type: ACCOUNT_S3_ACCESS_UPDATED, email });

    } catch (error) {
        dispatch({ type: ACCOUNT_S3_ACCESS_UPDATE_FAILED, email, error });
    }
}
