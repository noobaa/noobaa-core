/* Copyright (C) 2016 NooBaa */

import { CREATE_NAMESPACE_RESOURCE } from 'action-types';
import { completeCreateNamespaceResource, failCreateNamespaceResource } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(CREATE_NAMESPACE_RESOURCE)
        .flatMap(async action => {
            const { name, connection, target: target_bucket } = action.payload;

            try {
                await api.pool.create_namespace_resource({ name, connection, target_bucket });
                return completeCreateNamespaceResource(name);

            } catch (error) {
                return failCreateNamespaceResource(name, error);
            }
        });
}
