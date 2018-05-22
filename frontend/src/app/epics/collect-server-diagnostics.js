/* Copyright (C) 2016 NooBaa */

import { ofType } from 'rx-extensions';
import { mergeMap } from 'rxjs/operators';
import { mapErrorObject } from 'utils/state-utils';
import { COLLECT_SERVER_DIAGNOSTICS } from 'action-types';
import { completeCollectServerDiagnostics, failCollectServerDiagnostics } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(COLLECT_SERVER_DIAGNOSTICS),
        mergeMap(async action => {
            const { secret, hostname } = action.payload;

            try {
                const packageUri = await api.cluster_server.diagnose_system({
                    target_secret: secret
                });

                return completeCollectServerDiagnostics(secret, packageUri);
            } catch (error) {
                return failCollectServerDiagnostics(
                    secret,
                    hostname,
                    mapErrorObject(error)
                );
            }
        })
    );
}
