/* Copyright (C) 2016 NooBaa */

import { ADD_EXTERNAL_CONNECTION } from 'action-types';
import { completeAddExternalConnection, failAddExternalConnection } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(ADD_EXTERNAL_CONNECTION)
        .flatMap(async action => {
            const { name, service, endpoint, identity, secret } = action.payload;

            try {
                await api.account.add_external_connection({
                    name: name,
                    endpoint_type: service,
                    endpoint: endpoint,
                    identity: identity,
                    secret: secret
                });

                return completeAddExternalConnection(name);

            } catch (error) {
                return failAddExternalConnection(name, error);
            }
        });
}
