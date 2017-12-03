/* Copyright (C) 2016 NooBaa */

import { DELETE_NAMESPACE_RESOURCE } from 'action-types';
import { completeDeleteNamespaceResource, failDeleteNamespaceResource } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(DELETE_NAMESPACE_RESOURCE)
        .flatMap(async action => {
            const { name } = action.payload;

            try {
                await api.pool.delete_namespace_resource({ name });
                return completeDeleteNamespaceResource(name);

            } catch (error) {
                return failDeleteNamespaceResource(name, error);
            }
        });
}
