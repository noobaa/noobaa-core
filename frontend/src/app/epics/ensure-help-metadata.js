/* Copyright (C) 2016 NooBaa */

import { ENSURE_HELP_METADATA } from 'action-types';
import { completeEnsureHelpMetadata, failEnsureHelpMetadata } from 'action-creators';
import metaStore from '../services/external-data-store';

const helpMetadata = 'helpMetadata';

export default function(action$) {
    return action$
        .ofType(ENSURE_HELP_METADATA)
        .flatMap(async () => {
            try {
                await metaStore.fetch(helpMetadata);
                return completeEnsureHelpMetadata();
            } catch (error) {
                return failEnsureHelpMetadata(error);
            }
        });
}
