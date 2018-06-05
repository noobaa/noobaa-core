/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { escapeRegExp } from 'utils/string-utils';
import { mapErrorObject } from 'utils/state-utils';
import { all } from 'utils/promise-utils';
import { FETCH_OBJECT } from 'action-types';
import { completeFetchObject, failFetchObject } from 'action-creators';

const MAX_VERSION_COUNT = 100;

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_OBJECT),
        mergeMap(async action => {
            const { bucket, object, version, s3Endpoint } = action.payload;

            try {
                const [versions, curr] = await all(
                    // fetch object versions info.
                    api.object.list_objects_admin({
                        bucket: bucket,
                        key_regexp: `^${escapeRegExp(object)}$`,
                        skip: 0,
                        limit: MAX_VERSION_COUNT,
                        adminfo: {
                            signed_url_endpoint: s3Endpoint
                        }
                    }),
                    // Fetch the full object info for the requested version.
                    api.object.read_object_md({
                        bucket: bucket,
                        key: object,
                        version_id: version,
                        adminfo: {
                            signed_url_endpoint: s3Endpoint
                        }
                    })
                );

                // Override the current version with the full version info.
                const index = versions.objects.findIndex(ver => ver.obj_id === curr.obj_id);
                versions.objects[index] = curr;
                return completeFetchObject(bucket, object, version, versions);


            } catch (error) {
                return failFetchObject(
                    bucket, object, version,
                    mapErrorObject(error)
                );
            }

        })
    );
}


