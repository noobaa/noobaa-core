/* Copyright (C) 2016 NooBaa */

import { noop } from 'utils/core-utils';
import restoreSessionEpic  from 'epics/restore-session';
import { restoreSession, completeRestoreSession, failRestoreSession } from 'action-creators';
import { FAIL_RESTORE_SESSION } from 'action-types';
import { Observable } from 'rx';
import assert from 'assert';
import { describe, it } from 'mocha';
import { readAuthRetryCount, readAuthRetryDelay } from 'config';

// Create a promised based test given a read_auth mock, a token, and a callback
// to assert the result.
function test(read_auth, token) {
    const inject = {
        api: {
            options: {
                auth_token: undefined
            },
            auth: { read_auth }
        }
    };

    const action$ = Observable.of(
        restoreSession(token)
    );

    return restoreSessionEpic(action$, inject)
        .toPromise();
}

describe('Restore session', () => {

    describe('when given no token', () => {

        it('should not call read_auth', () => {
            function read_auth() {
                assert.fail('read_auth was called');
            }

            return test(read_auth);
        });

        it('should return a FAIL_RESTORE_SESSION action with an UNAUTHORIZED error in payload', () => {
            function read_auth() {
                return Promise.resolve();
            }

            return test(read_auth).then(
                ({ type, payload }) => assert(
                    type === FAIL_RESTORE_SESSION && payload.error.rpc_code === 'UNAUTHORIZED',
                    'Returned action was not of type FAIL_RESTORE_SESSION or has a payload with wrong error'
                )
            );
        });
    });

    describe('when encountering and UNAUTHORIZED rpc error', () => {

        it('should return a FAIL_RESTORE_SESSION action with the returned error in the payload', () => {
            const token = 'token';
            const error = new Error('UNAUTHORIZED');
            error.rpc_code = 'UNAUTHORIZED';

            function read_auth() {
                return Promise.reject(error);
            }

            return test(read_auth, token).then(
                action => assert.deepEqual(
                    action,
                    failRestoreSession(token, error),
                    'Returned action was not of type FAIL_RESTORE_SESSION or has a payload with wrong error'
                )
            );
        });
    });

    describe('when read_auth cannot match the token to an account', () => {
        it('should return a FAIL_RESTORE_SESSION action with an UNAUTHORIZED error in payload', () => {
            function read_auth() {
                return Promise.resolve({});
            }

            return test(read_auth, 'token').then(
                ({ type, payload }) => assert(
                    type === FAIL_RESTORE_SESSION && payload.error.rpc_code === 'UNAUTHORIZED',
                    'Returned action was not of type FAIL_RESTORE_SESSION or has a payload with wrong error'
                )
            );
        });
    });

    describe('when read_auth fails on RPC_CONNECT_TIMEOUT repeatedly', function() {
        this.timeout((readAuthRetryCount + 1) * readAuthRetryDelay);

        it(`should retry to call read_auth ${readAuthRetryCount} more times with a delay of ${readAuthRetryDelay}ms between calls`, () => {

            let callCount = 0;
            let lastCallTime = 0;

            function read_auth() {
                if (++callCount > readAuthRetryCount) {
                    assert.fail('read_auth was called too many times');
                }

                const now = Date.now();
                if (now - lastCallTime < readAuthRetryDelay) {
                    assert.fail('read_auth was called prematurely');
                }
                lastCallTime = now;

                const error = new Error('RPC_CONNECT_TIMEOUT');
                error.rpc_code = 'RPC_CONNECT_TIMEOUT';
                return Promise.reject(error);
            }

            return test(read_auth, 'token').catch(noop);
        });

        it('should reject with a RPC_CONNECT_TIMEOUT error', () => {
            function read_auth() {
                const error = new Error('RPC_CONNECT_TIMEOUT');
                error.rpc_code = 'RPC_CONNECT_TIMEOUT';
                return Promise.reject(error);
            }

            return test(read_auth, 'token').catch(
                error => assert(
                    error.rpc_code === 'RPC_CONNECT_TIMEOUT',
                    'Error rpc_code field is not RPC_CONNECT_TIMEOUT',
                )
            );
        });
    });

    describe('when encountering an unknown error', () => {
        it('should reject with that error', () => {
            const error = new Error();

            function read_auth() {
                return Promise.reject(error);
            }

            return test(read_auth, 'token').catch(
                catched => assert(
                    catched === error,
                    'Catched error is not the same as the read_auth rejected error'
                )
            );
        });
    });

    describe('when read_auth returns full session information', () => {

        it('should return COMPLETE_RESTORE_SESSION with the information in the payload', () => {
            const token = 'token';
            const sessionInfo = {
                account: {
                    email: 'test@noobaa.com',
                    must_change_password: Date.now()
                },
                system: {
                    name: 'test'
                }
            };

            function read_auth() {
                return Promise.resolve(sessionInfo);
            }

            return test(read_auth, token).then(
                action => assert.deepEqual(
                    action,
                    completeRestoreSession(token, sessionInfo),
                    'Returned action does not match expected action'
                )
            );
        });
    });

    describe('when read_auth fails initial request (with RPC_CONNECT_TIMEOUT) but succeed on a retry', () => {

        it('should return COMPLETE_RESTORE_SESSION with the information in the payload', () => {
            const token = 'token';
            const sessionInfo = {
                account: {
                    email: 'test@noobaa.com',
                    must_change_password: Date.now()
                },
                system: {
                    name: 'test'
                }
            };

            let firstTime = true;
            function read_auth() {
                if (firstTime) {
                    firstTime = false;
                    const error = new Error('RPC_CONNECT_TIMEOUT');
                    error.rpc_code = 'RPC_CONNECT_TIMEOUT';
                    return Promise.reject(error);
                }

                return Promise.resolve(sessionInfo);
            }

            return test(read_auth, token).then(
                action => assert.deepEqual(
                    action,
                    completeRestoreSession(token, sessionInfo),
                    'Returned action does not match expected action'
                )
            );
        });
    });

});
