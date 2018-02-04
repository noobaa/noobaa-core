/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { RESTORE_SESSION } from 'action-types';
import { completeRestoreSession, failRestoreSession } from 'action-creators';
import { readAuthRetryCount, readAuthRetryDelay } from 'config';
import { sessionTokenKey } from 'config';
import Rx from 'rx';

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
    return action$
        .ofType(RESTORE_SESSION)
        .flatMap(() => {
            const { token, persistent } = _loadStoredToken(sessionTokenKey, localStorage, sessionStorage);

            if (!token) {
                const error = _createUnauthorizedException('Token not available');
                return Rx.Observable.of(failRestoreSession(
                    token,
                    mapErrorObject(error)
                ));
            }

            api.options.auth_token = token;
            return Rx.Observable.fromPromise(() => api.auth.read_auth())
                .map(sessionInfo => {
                    if (!sessionInfo.account) {
                        throw _createUnauthorizedException('Account not found');
                    }

                    return completeRestoreSession(token, sessionInfo, persistent);
                })
                .retryWhen(errors => {
                    return errors
                        .scan((count, err) => {
                            if (err.rpc_code !== RPC_CONNECT_TIMEOUT || count >= readAuthRetryCount) {
                                throw err;
                            }

                            return count + 1;
                        }, 0)
                        .delay(readAuthRetryDelay);
                })
                .catch(error => {
                    if (error.rpc_code !== UNAUTHORIZED) throw error;
                    return Rx.Observable.of(failRestoreSession(token, mapErrorObject(error)));
                });
        });
}
