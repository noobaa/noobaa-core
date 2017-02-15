import { dispatch } from 'state-actions';
import api from 'services/api';

export async function fetchSystemInfo() {
    const info = await api.system.read_system();
    dispatch({ type: 'SYSTEM_INFO_FETCHED', info });
}


export async function upgradeSystem() {
    dispatch({ type: 'UPGRADE_SYSTEM' });

    // REFACTOR: move the actual upgrade process from actions.js to here.
}
