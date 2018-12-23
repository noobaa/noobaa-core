/* Copyright (C) 2016 NooBaa */

import { of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import {
    closeModal,
    openPasswordResetCompletedModal,
    openPasswordResetFailedModal
} from 'action-creators';
import {
    COMPLETE_RESET_ACCOUNT_PASSWORD,
    FAIL_RESET_ACCOUNT_PASSWORD
} from 'action-types';


const handlers = {
    [COMPLETE_RESET_ACCOUNT_PASSWORD]: action => {
        const { accountName, password } = action.payload;
        return openPasswordResetCompletedModal(accountName, password);
    },
    [FAIL_RESET_ACCOUNT_PASSWORD]: action => {
        const { accountName } = action.payload;
        return openPasswordResetFailedModal(accountName);
    }
};

export default function(action$) {
    return action$.pipe(
        ofType(...Object.keys(handlers)),
        mergeMap(action => of(
            closeModal(),
            handlers[action.type](action)
        ))
    );
}

