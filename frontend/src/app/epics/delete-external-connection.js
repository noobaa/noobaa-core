/* Copyright (C) 2016 NooBaa */

import { DELETE_EXTERNAL_CONNECTION } from 'action-types';
import { completeDeleteExternalConnection, failDeleteExternalConnection } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(DELETE_EXTERNAL_CONNECTION)
        .flatMap(async action => {
            const { connection } = action.payload;

            try {
                await api.account.delete_external_connection({
                    connection_name: connection
                });

                return completeDeleteExternalConnection(connection);
            } catch (error) {
                return failDeleteExternalConnection(connection, error);
            }
        });
}
