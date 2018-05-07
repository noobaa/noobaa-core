/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { COLLECT_HOST_DIAGNOSTICS } from 'action-types';
import { completeCollectHostDiagnostics, failCollectHostDiagnostics } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(COLLECT_HOST_DIAGNOSTICS),
        mergeMap(async action => {
            const { host } = action.payload;

            try {
                const packageUri = await api.host.diagnose_host({ name: host });
                return completeCollectHostDiagnostics(host, packageUri);

            } catch (error) {
                return failCollectHostDiagnostics(
                    host,
                    mapErrorObject(error)
                );
            }
        })
    );
}
