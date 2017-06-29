/* Copyright (C) 2016 NooBaa */

import api from 'services/api';
import { RESTORE_SESSION } from 'action-types';
import { completeRestoreSession, failResotreSession } from 'action-creators';
import { readAuthRetryCount } from 'config';
import Rx from 'rx';

function _createUnauthorizedException(message) {
    const error = new Error(message);
    error.rpc_code = 'UNAUTHORIZED';
    return error;
}

export default function(action$) {
    return action$
        .ofType(RESTORE_SESSION)
        .flatMap(action => {
            const { token } = action.payload;
            if (!token) {
                const error = _createUnauthorizedException('Token not available');
                throw { token, error };
            }

            api.options.auth_token = token;
            return Rx.Observable.fromPromise(() => api.auth.read_auth())
                .map(sessionInfo => {
                    if (!sessionInfo.account) {
                        throw _createUnauthorizedException('Account not found');
                    }

                    return completeRestoreSession(token, sessionInfo);
                })
                .retryWhen(errors => {
                    return errors
                        .scan((count, err) => {
                            if (err.rpc_code !== 'RPC_CONNECT_TIMEOUT' || count >= readAuthRetryCount) {
                                throw err;
                            }

                            return count + 1;
                        }, 0)
                        .delay(1000);
                })
                .catch(error => {
                    throw { token, error };
                });
        })
        .catch(({ token, error }) => Rx.Observable.of(
            failResotreSession(token, error)
        ));
}
