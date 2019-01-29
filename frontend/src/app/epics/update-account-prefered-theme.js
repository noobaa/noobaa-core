/* Copyright (C) 2016 NooBaa */

import { of } from 'rxjs';
import { mergeMap, retryWhen, delay, take } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { UPDATE_ACCOUNT_UI_THEME } from 'action-types';

const retryCount = 2;
const retryDelay = 500;

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_ACCOUNT_UI_THEME),
        mergeMap(action => {
            const { accountName, theme } = action.payload;
            return of(true).pipe(
                mergeMap(() => api.account.update_account({
                    email: accountName,
                    preferences: { ui_theme: theme.toUpperCase() }
                })),
                retryWhen(errors => errors.pipe(
                    delay(retryDelay),
                    take(retryCount)
                ))
            );
        })
    );
}
