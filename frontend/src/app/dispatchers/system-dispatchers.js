import { dispatch } from 'state-actions';
import api from 'services/api';

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
