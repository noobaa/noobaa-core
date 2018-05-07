/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { ENTER_MAINTENANCE_MODE } from 'action-types';
import { completeEnterMaintenanceMode, failEnterMaintenanceMode } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(ENTER_MAINTENANCE_MODE),
        mergeMap(async action => {
            const { duration } = action.payload;
            try {
                await api.system.set_maintenance_mode({ duration });

                return completeEnterMaintenanceMode();
            } catch (error) {
                return failEnterMaintenanceMode(
                    mapErrorObject(error)
                );
            }
        })
    );
}
