import { FETCH_HOST_OBJECTS } from 'action-types';
import { completeFetchHostObjects, failFetchHostObjects } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(FETCH_HOST_OBJECTS)
        .flatMap(async action => {
            const { host, skip, limit } = action.payload;

            try {
                const response = await api.object.read_host_mappings({
                    name: host,
                    skip: skip,
                    limit: limit,
                    adminfo: true
                });

                return completeFetchHostObjects(host, skip, limit, response);

            } catch (error) {
                return failFetchHostObjects(host, skip, limit, error);
            }
        });
}
