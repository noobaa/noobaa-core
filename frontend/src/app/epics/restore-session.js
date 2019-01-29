/* Copyright (C) 2016 NooBaa */

import { mergeMap, map, retryWhen, catchError, scan, delay } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { RESTORE_SESSION } from 'action-types';
import { completeRestoreSession, failRestoreSession } from 'action-creators';
import { readAuthRetryCount, readAuthRetryDelay } from 'config';
import { sessionTokenKey } from 'config';
import { of } from 'rxjs';

const UNAUTHORIZED = 'UNAUTHORIZED';
const RPC_CONNECT_TIMEOUT = 'RPC_CONNECT_TIMEOUT';

function _loadStoredToken(key, localStorage, sessionStorage) {
    const sessionToken = sessionStorage.getItem(key);
    const localToken = localStorage.getItem(key);

    return {
        token: sessionToken || localToken,
        persistent: Boolean(localToken)
    };
}

function _createUnauthorizedException(message) {
    const error = new Error(message);
    error.rpc_code = UNAUTHORIZED;
    return error;
}

export default function(action$, { api, localStorage, sessionStorage }) {
    return action$.pipe(
        ofType(RESTORE_SESSION),
        mergeMap(() => {
            const { token, persistent } = _loadStoredToken(sessionTokenKey, localStorage, sessionStorage);

            if (!token) {
                const error = _createUnauthorizedException('Token not available');
                return of(failRestoreSession(
                    token,
                    mapErrorObject(error)
                ));
            }

            api.options.auth_token = token;
            return of(true).pipe(
                mergeMap(async () => {
                    const sessionInfo = await api.auth.read_auth();
                    const account = await api.account.read_account({ email: sessionInfo.account.email });
                    const uiTheme = account.preferences.ui_theme.toLowerCase();
                    return { sessionInfo: sessionInfo, uiTheme  };
                }),
                map(({ sessionInfo, uiTheme }) => {
                    if (!sessionInfo.account) {
                        throw _createUnauthorizedException('Account not found');
                    }

                    return completeRestoreSession(token, sessionInfo, persistent, uiTheme);
                }),
                retryWhen(errors => errors.pipe(
                    scan((count, err) => {
                        if (err.rpc_code !== RPC_CONNECT_TIMEOUT || count >= readAuthRetryCount) {
                            throw err;
                        }

                        return count + 1;
                    }, 0),
                    delay(readAuthRetryDelay)
                )),
                catchError(error => {
                    if (error.rpc_code !== UNAUTHORIZED) throw error;
                    return of(failRestoreSession(token, mapErrorObject(error)));
                })
            );
        })
    );
}
