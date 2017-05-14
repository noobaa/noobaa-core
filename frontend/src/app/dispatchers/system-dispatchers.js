/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state';
import api from 'services/api';
import { all, sleep } from 'utils/promise-utils';
import { START_FETCH_SYSTEM_INFO, COMPLETE_FETCH_SYSTEM_INFO, FAIL_FETCH_SYSTEM_INFO,
    START_FETCH_NODE_INSTALLATION_COMMANDS, COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS,
    FAIL_FETCH_NODE_INSTALLATION_COMMANDS, START_UPGRADE_SYSTEM,
    START_CREATE_ACCOUNT,  COMPLETE_CREATE_ACCOUNT, FAIL_CREATE_ACCOUNT,
    START_UPDATE_ACCOUNT_S3_ACCESS, COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_ACCOUNT_S3_ACCESS } from 'action-types';

export async function fetchSystemInfo() {
    dispatch({ type: START_FETCH_SYSTEM_INFO });

    try {
        const info = await api.system.read_system();
        dispatch({
            type: COMPLETE_FETCH_SYSTEM_INFO,
            payload: info
        });

    } catch (error) {
        dispatch({
            type: FAIL_FETCH_SYSTEM_INFO,
            payload: { error }
        });
    }
}

export async function fetchNodeInstallationCommands(targetPool, excludedDrives) {
    dispatch({ type: START_FETCH_NODE_INSTALLATION_COMMANDS });

    try {
        const commands = await api.system.get_node_installation_string({
            pool: targetPool,
            exclude_drives: excludedDrives
        });

        dispatch({
            type: COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS,
            payload: { targetPool, excludedDrives, commands }
        });

    } catch (error) {
        dispatch({
            type: FAIL_FETCH_NODE_INSTALLATION_COMMANDS,
            paylaod: { error }
        });
    }
}

export async function upgradeSystem() {
    dispatch({ type: START_UPGRADE_SYSTEM });
    // TODO REFACTOR: move the actual upgrade process from actions.js to here.
}

export async function createAccount(email, password, s3Access, defaultResource, allowedBuckets) {
    dispatch({
        type: START_CREATE_ACCOUNT,
        payload: { email, password, s3Access, defaultResource, allowedBuckets }
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

        dispatch({
            type: COMPLETE_CREATE_ACCOUNT,
            payload: { email }
        });

    } catch (error) {
        dispatch({
            type: FAIL_CREATE_ACCOUNT,
            payload: { email, error }
        });
    }
}

export async function updateAccountS3Access(email, s3Access, defaultResource, allowedBuckets) {
    dispatch({
        type: START_UPDATE_ACCOUNT_S3_ACCESS,
        payload: { email, s3Access, defaultResource, allowedBuckets }
    });

    try {
        await api.account.update_account_s3_access({
            email: email,
            s3_access: s3Access,
            default_pool: s3Access ? defaultResource : undefined,
            allowed_buckets: s3Access ? allowedBuckets : undefined
        });

        dispatch({
            type: COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
            payload: { email }
        });

    } catch (error) {
        dispatch({
            type: FAIL_UPDATE_ACCOUNT_S3_ACCESS,
            payload: { email, error }
        });
    }
}
