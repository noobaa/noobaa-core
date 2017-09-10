/* Copyright (C) 2016 NooBaa */

import { ENSURE_HELP_META } from 'action-types';
import { completeEnsureHelpMeta, failEnsureHelpMeta } from 'action-creators';
import metaStore from '../services/external-data-store';

export default function(action$) {
    return action$
        .ofType(ENSURE_HELP_META)
        .flatMap(async () => {
            try {
                await metaStore.fetch('interactiveHelp');
                return completeEnsureHelpMeta();

            } catch (error) {
                return failEnsureHelpMeta(error);
            }
        });
}
