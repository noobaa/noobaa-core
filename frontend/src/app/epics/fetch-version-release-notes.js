/* Copyright (C) 2016 NooBaa */

import { switchMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_VERSION_RELEASE_NOTES } from 'action-types';
import { releaseNotes } from 'config';
import {
    completeFetchVersionReleaseNotes,
    failFetchVersionReleaseNotes
} from 'action-creators';

export default function(action$, { fetch }) {
    return action$.pipe(
        ofType(FETCH_VERSION_RELEASE_NOTES),
        switchMap(async action => {
            const { baseUrl, suffix } = releaseNotes;
            const { version } = action.payload;
            const [ versionWithNoBuildNumber ] = version.split('-');
            const url = `${baseUrl}/${versionWithNoBuildNumber}.${suffix}`;
            const alpha_url = `${baseUrl}/${versionWithNoBuildNumber}-alpha.${suffix}`;

            try {
                let res1 = await fetch(url);
                if (!res1.ok) { 
                    const res2 = await fetch(alpha_url);
                    if (!res2.ok) throw new Error(`Got HTTP: ${res1.status}`);
                    res1 = res2;
                }
                const notes = await(res1).text();
                return completeFetchVersionReleaseNotes(version, notes);

            } catch (error) {
                return failFetchVersionReleaseNotes(
                    version,
                    mapErrorObject(error)
                );
            }
        })
    );
}
