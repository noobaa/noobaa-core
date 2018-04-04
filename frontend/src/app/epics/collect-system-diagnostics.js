/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { COLLECT_SYSTEM_DIAGNOSTICS } from 'action-types';
import { completeCollectSystemDiagnostics, failCollectSystemDiagnostics } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(COLLECT_SYSTEM_DIAGNOSTICS)
        .flatMap(async () => {
            try {
                const packageUri = await api.cluster_server.diagnose_system({});
                return completeCollectSystemDiagnostics(packageUri);
            } catch (error) {
                return failCollectSystemDiagnostics(
                    mapErrorObject(error)
                );
            }
        });
}
