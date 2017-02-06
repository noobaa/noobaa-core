import { getUnreadAlertsCount } from 'dispatchers';

export function alert() {
    getUnreadAlertsCount();
}
