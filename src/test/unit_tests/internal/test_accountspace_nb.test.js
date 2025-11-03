/* Copyright (C) 2025 NooBaa */
/* eslint-disable max-lines-per-function */
/* eslint-disable max-lines */
'use strict';


const AccountSpaceNB = require('../../../sdk/accountspace_nb');
const { IamError } = require('../../../endpoint/iam/iam_errors');

class NoErrorThrownError extends Error {}

const accountspace_nb = new AccountSpaceNB({ rpc_client: null, internal_rpc_client: null });

describe('Accountspace_NB tests', () => {
    describe('Accountspace_NB user policy tests', () => {
        describe('put_user_policy', () => {
            it('Should return Not Implemented error for put_user_policy', async () => {
                try {
                    await accountspace_nb.put_user_policy({}, accountspace_nb);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NotImplemented.code);
                }
            });
        });

        describe('get_user_policy', () => {
            it('Should return Not Implemented error for get_user_policy', async () => {
                try {
                    await accountspace_nb.get_user_policy({}, accountspace_nb);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NotImplemented.code);
                }
            });
        });

        describe('delete_user_policy', () => {
            it('Should return Not Implemented error for delete_user_policy', async () => {
                try {
                    await accountspace_nb.delete_user_policy({}, accountspace_nb);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NotImplemented.code);
                }
            });
        });

        describe('list_user_policies', () => {
            it('Should return Not Implemented error for list_user_policies', async () => {
                try {
                    await accountspace_nb.list_user_policies({}, accountspace_nb);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NotImplemented.code);
                }
            });
        });
    });
});
