/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { DELETE_HOST } from 'action-types';
import { completeDeleteHost, failDeleteHost } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(DELETE_HOST),
        mergeMap(async action => {
            const { host } = action.payload;
            try {
                await api.host.delete_host({ name: host });
                return completeDeleteHost(host);

            } catch (error) {
                return failDeleteHost(
                    host,
                    mapErrorObject(error)
                );
            }
        })
    );
}
