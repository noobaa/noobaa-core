/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { LEAVE_MAINTENANCE_MODE } from 'action-types';
import { completeLeaveMaintenanceMode, failLeaveMaintenanceMode } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(LEAVE_MAINTENANCE_MODE)
        .flatMap(async () => {
            try {
                await api.system.set_maintenance_mode({ duration : 0 });

                return completeLeaveMaintenanceMode();
            } catch (error) {
                return failLeaveMaintenanceMode(
                    mapErrorObject(error)
                );
            }
        });
}
