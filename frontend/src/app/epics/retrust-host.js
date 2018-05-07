/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { RETRUST_HOST } from 'action-types';
import { completeRetrustHost, failRetrustHost } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(RETRUST_HOST),
        mergeMap(async action => {
            const { host } = action.payload;
            try {
                await api.host.retrust_host({ name: host });
                return completeRetrustHost(host);

            } catch (error) {
                return failRetrustHost(host, mapErrorObject(error));
            }
        })
    );
}
