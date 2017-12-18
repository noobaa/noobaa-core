/* Copyright (C) 2017 NooBaa */

import { INVOKE_UPGRADE_SYSTEM } from 'action-types';
import { completeInvokeUpgradeSystem, failInvokeUpgradeSystem } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(INVOKE_UPGRADE_SYSTEM)
        .flatMap(async () => {
            try {
                await api.cluster_internal.upgrade_cluster();
                return completeInvokeUpgradeSystem();

            } catch (error) {
                return failInvokeUpgradeSystem(error);
            }
        });
}



