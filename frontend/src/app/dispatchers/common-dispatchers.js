import { dispatch } from 'state-actions';
import api from 'services/api';

export async function fetchSystemInfo() {
    const info = await api.system.read_system();
    dispatch({ type: 'SYSTEM_INFO_FETCHED', info });
}

