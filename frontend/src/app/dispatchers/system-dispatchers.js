import { dispatch } from 'state-actions';
import api from 'services/api';
import { all, sleep } from 'utils/promise-utils';

export async function fetchSystemInfo() {
    const info = await api.system.read_system();
    dispatch({ type: 'SYSTEM_INFO_FETCHED', info });
}

export async function fetchNodeInstallationCommand(osType, excludedDrives) {
    const command = await api.system.get_node_installation_string({
        os_type: osType,
        exclude_drives: excludedDrives
    });
    dispatch({ type: 'NODE_INSTALLATION_COMMAND_FETCHED',
        osType, excludedDrives, command  });
}

export async function upgradeSystem() {
    dispatch({ type: 'UPGRADE_SYSTEM' });

    // REFACTOR: move the actual upgrade process from actions.js to here.
}


export async function createAccount(email, password, defaultResource, s3AccessList) {
    dispatch({
        type: 'CREATE_ACCOUNT',
        email,
        password,
        defaultResource,
        s3AccessList
    });

    try {
        await all(
            api.account.create_account({
                name: email.split('@')[0],
                email: email,
                password: password,
                must_change_password: true,
                s3_access: Boolean(s3AccessList),
                allowed_buckets: s3AccessList,
                default_pool: defaultResource
            }),
            sleep(750)
        );

        dispatch({ type: 'ACCOUNT_CREATED', email });

    } catch (error) {
        dispatch({ type: 'ACCOUNT_CREATION_FAILED', email, error });
    }
}
