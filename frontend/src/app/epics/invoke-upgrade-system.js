/* Copyright (C) 2017 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { INVOKE_UPGRADE_SYSTEM } from 'action-types';
import { completeInvokeUpgradeSystem, failInvokeUpgradeSystem } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(INVOKE_UPGRADE_SYSTEM),
        mergeMap(async () => {
            try {
                await api.upgrade.upgrade_cluster();
                return completeInvokeUpgradeSystem();

            } catch (error) {
                return failInvokeUpgradeSystem(mapErrorObject(error));
            }
        })
    );
}



