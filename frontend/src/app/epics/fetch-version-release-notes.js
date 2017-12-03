/* Copyright (C) 2016 NooBaa */

import { FETCH_VERSION_RELEASE_NOTES } from 'action-types';
import { releaseNotes } from 'config';
import {
    completeFetchVersionReleaseNotes,
    failFetchVersionReleaseNotes
} from 'action-creators';

export default function(action$, { fetch }) {
    return action$
        .ofType(FETCH_VERSION_RELEASE_NOTES)
        .switchMap(async action => {
            const { baseUrl, suffix } = releaseNotes;
            const { version } = action.payload;
            const [ versionWithNoBuildNumber ] = version.split('-');
            const url = `${baseUrl}/${versionWithNoBuildNumber}.${suffix}`;

            try {
                const notes = await(await fetch(url)).text();
                return completeFetchVersionReleaseNotes(version, notes);

            } catch (error) {
                return failFetchVersionReleaseNotes(version, error);
            }
        });
}
