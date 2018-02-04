/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { noop } from 'utils/core-utils';
import restoreSessionEpic  from 'epics/restore-session';
import { restoreSession, completeRestoreSession, failRestoreSession } from 'action-creators';
import { FAIL_RESTORE_SESSION } from 'action-types';
import { Observable } from 'rx';
import assert from 'assert';
import { describe, it } from 'mocha';
import { readAuthRetryCount, readAuthRetryDelay, sessionTokenKey } from 'config';

function mockServices(
    read_auth,
    sessionStorageGetItem,
    localStorageGetItem = sessionStorageGetItem
) {
    return {
        api: {
            options: {
                auth_token: undefined
            },
            auth: { read_auth }
        },
        sessionStorage: {
            getItem: sessionStorageGetItem
        },
        localStorage: {
            getItem: localStorageGetItem
        }
    };
}

// Create a promised based test given a read_auth mock, a token, and a callback
// to assert the result.
function test(injectedServices) {

    const action$ = Observable.of(
        restoreSession()
    );

    return restoreSessionEpic(action$, injectedServices)
        .toPromise();
}

describe('Restore session', () => {

    describe('when there is no token saved in localStorage or sessionStorage', () => {
        const services = mockServices(
            () => assert.fail('read_auth was called'),
            () => null
        );

        it('should not call read_auth', () => {
            return test(services);
        });

        it('should return a FAIL_RESTORE_SESSION action with an UNAUTHORIZED error in payload', () => {
            return test(services).then(
                ({ type, payload }) => assert(
                    type === FAIL_RESTORE_SESSION && payload.error.rpc_code === 'UNAUTHORIZED',
                    'Returned action was not of type FAIL_RESTORE_SESSION or has a payload with wrong error'
                )
            );
        });
    });

    describe('when a token is saved in any storage cache', () => {
        it(`should try to retrieve the token using the "${sessionTokenKey}" key`, () => {
            const services = mockServices(
                () => Promise.resolve({}),
                key => assert(key === sessionTokenKey, `key "${key}"" is diffrent from "${sessionTokenKey}"`)
            );

            return test(services);
        });

        it('should try to retrieve the token from sessionStorage before trying localStorage', () => {
            const shouldBeTheToken = 'shouldBeTheToken';
            const shouldNotBeTheToken = 'shouldNotBeTheToken';

            const services = mockServices(
                () => Promise.resolve({}),
                () => shouldBeTheToken,
                () => shouldNotBeTheToken
            );

            return test(services)
                .then(({ payload }) => assert(
                    payload.token === shouldBeTheToken,
                    'Token was taken from localStorage instead of sessionStorage'
                ));
        });
    });

    describe('when encountering andUNAUTHORIZED rpc error', () => {
        it('should return a FAIL_RESTORE_SESSION action with the returned error in the payload', () => {
            const token = 'token';
            const error = new Error('UNAUTHORIZED');
            error.rpc_code = 'UNAUTHORIZED';

            const services = mockServices(
                () => Promise.reject(error),
                () => token
            );

            return test(services).then(
                action => assert.deepEqual(
                    action,
                    failRestoreSession(token, mapErrorObject(error)),
                    'Returned action was not of type FAIL_RESTORE_SESSION or has a payload with wrong error'
                )
            );
        });
    });

    describe('when read_auth cannot match the token to an account', () => {
        it('should return a FAIL_RESTORE_SESSION action with an UNAUTHORIZED error in payload', () => {
            const services = mockServices(
                () => Promise.resolve({}),
                () => 'token'
            );

            return test(services).then(
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

            const services = mockServices(
                read_auth,
                () => 'token'
            );

            return test(services).catch(noop);
        });

        it('should reject with a RPC_CONNECT_TIMEOUT error', () => {
            const services = mockServices(
                () => {
                    const error = new Error('RPC_CONNECT_TIMEOUT');
                    error.rpc_code = 'RPC_CONNECT_TIMEOUT';
                    return Promise.reject(error);
                },
                () => 'token'
            );

            return test(services).catch(
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
            const services = mockServices(
                () => Promise.reject(error),
                () => 'token'
            );

            return test(services).catch(
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

            const services = mockServices(
                () => Promise.resolve(sessionInfo),
                () => token
            );

            return test(services).then(
                action => assert.deepEqual(
                    action,
                    completeRestoreSession(token, sessionInfo, true),
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

            const services = mockServices(
                read_auth,
                () => token
            );

            return test(services).then(
                action => assert.deepEqual(
                    action,
                    completeRestoreSession(token, sessionInfo, true),
                    'Returned action does not match expected action'
                )
            );
        });
    });
});
