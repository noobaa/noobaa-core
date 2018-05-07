/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { DELETE_EXTERNAL_CONNECTION } from 'action-types';
import { completeDeleteExternalConnection, failDeleteExternalConnection } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(DELETE_EXTERNAL_CONNECTION),
        mergeMap(async action => {
            const { connection } = action.payload;

            try {
                await api.account.delete_external_connection({
                    connection_name: connection
                });

                return completeDeleteExternalConnection(connection);

            } catch (error) {
                return failDeleteExternalConnection(
                    connection,
                    mapErrorObject(error)
                );
            }
        })
    );
}
