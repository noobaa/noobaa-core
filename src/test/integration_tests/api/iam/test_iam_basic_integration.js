/* Copyright (C) 2024 NooBaa */
/* eslint-disable max-statements */
/* eslint-disable max-lines-per-function */
'use strict';

const path = require('path');
const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const SensitiveString = require('../../../../util/sensitive_string');
const fs_utils = require('../../../../util/fs_utils');
const { TMP_PATH, generate_nsfs_account, get_new_buckets_path_by_test_env, generate_iam_client,
         require_coretest, is_nc_coretest } = require('../../../system_tests/test_utils');
const { ListUsersCommand, CreateUserCommand, GetUserCommand, UpdateUserCommand, DeleteUserCommand,
        ListAccessKeysCommand, CreateAccessKeyCommand, GetAccessKeyLastUsedCommand,
        UpdateAccessKeyCommand, DeleteAccessKeyCommand,
        ListUserPoliciesCommand, PutUserPolicyCommand, DeleteUserPolicyCommand, GetUserPolicyCommand,
        ListUserTagsCommand, TagUserCommand, UntagUserCommand,
        ListGroupsForUserCommand, ListAccountAliasesCommand, ListAttachedGroupPoliciesCommand,
        ListAttachedRolePoliciesCommand, ListAttachedUserPoliciesCommand, ListEntitiesForPolicyCommand,
        ListGroupPoliciesCommand, ListGroupsCommand, ListInstanceProfilesCommand,
        ListInstanceProfilesForRoleCommand, ListInstanceProfileTagsCommand, ListMFADevicesCommand,
        ListMFADeviceTagsCommand, ListOpenIDConnectProvidersCommand, ListOpenIDConnectProviderTagsCommand,
        ListPoliciesCommand, ListPolicyTagsCommand, ListPolicyVersionsCommand, ListRolesCommand,
        ListRoleTagsCommand, ListSAMLProvidersCommand, ListServerCertificatesCommand,
        ListServerCertificateTagsCommand, ListServiceSpecificCredentialsCommand,
        ListSigningCertificatesCommand, ListSSHPublicKeysCommand,
        ListVirtualMFADevicesCommand } = require('@aws-sdk/client-iam');
const { ACCESS_KEY_STATUS_ENUM } = require('../../../../endpoint/iam/iam_constants');
const IamError = require('../../../../endpoint/iam/iam_errors').IamError;


const coretest = require_coretest();
let setup_options;
if (is_nc_coretest) {
    setup_options = { should_run_iam: true, https_port_iam: 7005, debug: 5 };
}
coretest.setup(setup_options);
const { rpc_client, EMAIL, get_current_setup_options, stop_nsfs_process, start_nsfs_process } = coretest;

let iam_account;
let account_res;
let config_root;

mocha.describe('IAM integration tests', async function() {
    this.timeout(50000); // eslint-disable-line no-invalid-this

    mocha.before(async () => {
        // we want to make sure that we run this test with a couple of forks (by default setup it is 0)
        if (is_nc_coretest) {
            config_root = path.join(TMP_PATH, 'test_nc_iam');
            // on NC - new_buckets_path is full absolute path
            // on Containerized - new_buckets_path is the directory
            const new_bucket_path_param = get_new_buckets_path_by_test_env(config_root, '/');

            const current_setup_options = get_current_setup_options();
            const same_setup = _.isEqual(current_setup_options, setup_options);
            if (!same_setup) {
                console.log('current_setup_options', current_setup_options, 'same_setup', same_setup);
                await stop_nsfs_process();
                await start_nsfs_process(setup_options);
            }
            await fs_utils.create_fresh_path(new_bucket_path_param);
            await fs_utils.file_must_exist(new_bucket_path_param);
            account_res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { admin: true });
        } else {
            account_res = (await rpc_client.account.read_account({ email: EMAIL })).access_keys[0];
        }

        // needed details for creating the account (and then the client)
        const coretest_endpoint_iam = coretest.get_https_address_iam();
        const access_key = account_res.access_key instanceof SensitiveString ?
            account_res.access_key.unwrap() :
            account_res.access_key;
        const secret_key = account_res.secret_key instanceof SensitiveString ?
            account_res.secret_key.unwrap() :
            account_res.secret_key;
        iam_account = generate_iam_client(access_key, secret_key, coretest_endpoint_iam);
    });

    mocha.after(async () => {
        if (is_nc_coretest) {
            fs_utils.folder_delete(`${config_root}`);
        }
    });

    mocha.describe('IAM basic integration tests - happy path', async function() {

        mocha.describe('IAM User API', async function() {
            const username = 'Asahi';
            const new_username = 'Botan';

            mocha.it('list users - should be empty', async function() {
                const input = {};
                const command = new ListUsersCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Users.length, 0);
            });

            mocha.it('create a user', async function() {
                const input = {
                    UserName: username
                };
                const command = new CreateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.User.UserName, username);

                // verify it using list users
                const input2 = {};
                const command2 = new ListUsersCommand(input2);
                const response2 = await iam_account.send(command2);
                assert.equal(response2.$metadata.httpStatusCode, 200);
                assert.equal(response2.Users.length, 1);
                assert.equal(response2.Users[0].UserName, username);
            });

            mocha.it('get a user', async function() {
                const input = {
                    UserName: username
                };
                const command = new GetUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.User.UserName, username);
            });

            mocha.it('update a user', async function() {
                const input = {
                    NewUserName: new_username,
                    UserName: username
                };
                const command = new UpdateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);

                // verify it using list users
                const input2 = {};
                const command2 = new ListUsersCommand(input2);
                const response2 = await iam_account.send(command2);
                _check_status_code_ok(response2);
                assert.equal(response2.Users.length, 1);
                assert.equal(response2.Users[0].UserName, new_username);
            });

            mocha.it('delete a user', async function() {
                const input = {
                    UserName: new_username // delete a user after its username was updated
                };
                const command = new DeleteUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });
        });

        mocha.describe('IAM Access Key API', async function() {
            const username2 = 'Fuji';
            let access_key_id;

            mocha.before(async () => {
                // create a user
                const input = {
                    UserName: username2
                };
                const command = new CreateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.after(async () => {
                // delete a user
                const input = {
                    UserName: username2
                };
                const command = new DeleteUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                // note: if somehow the delete access key would fail, then deleting the user would also fail
                // (as we can delete a user only after its access keys were deleted)
            });

            mocha.it('list access keys - should be empty', async function() {
                const input = {
                    UserName: username2
                };
                const command = new ListAccessKeysCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.AccessKeyMetadata.length, 0);
            });

            mocha.it('create access keys', async function() {
                const input = {
                    UserName: username2
                };
                const command = new CreateAccessKeyCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.AccessKey.UserName, username2);
                assert(response.AccessKey.AccessKeyId !== undefined);
                access_key_id = response.AccessKey.AccessKeyId;
                assert(response.AccessKey.SecretAccessKey !== undefined);
                assert.equal(response.AccessKey.Status, ACCESS_KEY_STATUS_ENUM.ACTIVE);

                // verify it using list access keys
                const input2 = {
                    UserName: username2
                };
                const command2 = new ListAccessKeysCommand(input2);
                const response2 = await iam_account.send(command2);
                _check_status_code_ok(response2);
                assert.equal(response2.AccessKeyMetadata.length, 1);
                assert.equal(response2.AccessKeyMetadata[0].UserName, username2);
                assert.equal(response2.AccessKeyMetadata[0].AccessKeyId, access_key_id);
                assert.equal(response2.AccessKeyMetadata[0].Status, ACCESS_KEY_STATUS_ENUM.ACTIVE);
            });

            mocha.it('get access key (last used)', async function() {
                // Skipping for containerized noobaa
                if (!is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
                const input = {
                    AccessKeyId: access_key_id
                };
                const command = new GetAccessKeyLastUsedCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.UserName, username2);
                assert(response.AccessKeyLastUsed.LastUsedDate !== undefined);
                assert(response.AccessKeyLastUsed.ServiceName !== undefined);
                assert(response.AccessKeyLastUsed.Region !== undefined);
            });

            mocha.it('update access keys (active to inactive)', async function() {
                const input = {
                    UserName: username2,
                    AccessKeyId: access_key_id,
                    Status: ACCESS_KEY_STATUS_ENUM.INACTIVE
                };
                const command = new UpdateAccessKeyCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);

                // verify it using list access keys
                const input2 = {
                    UserName: username2
                };
                const command2 = new ListAccessKeysCommand(input2);
                const response2 = await iam_account.send(command2);
                _check_status_code_ok(response2);
                assert.equal(response2.AccessKeyMetadata.length, 1);
                assert.equal(response2.AccessKeyMetadata[0].UserName, username2);
                assert.equal(response2.AccessKeyMetadata[0].AccessKeyId, access_key_id);
                assert.equal(response2.AccessKeyMetadata[0].Status, ACCESS_KEY_STATUS_ENUM.INACTIVE);
            });

            mocha.it('delete access keys', async function() {
                const input = {
                    UserName: username2,
                    AccessKeyId: access_key_id
                };
                const command = new DeleteAccessKeyCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });
        });

        mocha.describe('IAM User Policy API', async function() {
            if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
            const username3 = 'Kai';
            const policy_name = 'AllAccessPolicy';
            const iam_user_inline_policy_document = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}';

            mocha.before(async () => {
                // create a user
                const input = {
                    UserName: username3
                };
                const command = new CreateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.after(async () => {
                // delete a user
                const input = {
                    UserName: username3
                };
                const command = new DeleteUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                // note: if somehow the delete user policy would fail, then deleting the user would also fail
                // (as we can delete a user only after its user policies were deleted)
            });

            mocha.it('list user policies for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListUserPoliciesCommand(input);
                    await iam_account.send(command);
                    assert.fail('list user policies for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list user policies for user - should be empty', async function() {
                const input = {
                    UserName: username3
                };
                const command = new ListUserPoliciesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.PolicyNames.length, 0);
            });

            mocha.it('put user policy', async function() {
                const input = {
                    UserName: username3,
                    PolicyName: policy_name,
                    PolicyDocument: iam_user_inline_policy_document
                };
                const command = new PutUserPolicyCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);

                // verify it using list user policies
                const input2 = {
                    UserName: username3
                };
                const command2 = new ListUserPoliciesCommand(input2);
                const response2 = await iam_account.send(command2);
                _check_status_code_ok(response2);
                assert.equal(response2.PolicyNames.length, 1);
                assert.equal(response2.PolicyNames[0], policy_name);
            });

            mocha.it('get user policy', async function() {
                const input = {
                    UserName: username3,
                    PolicyName: policy_name
                };
                const command = new GetUserPolicyCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.UserName, username3);
                assert.equal(response.PolicyName, policy_name);
                assert(response.PolicyDocument !== undefined);
                const response_policy_document_json = JSON.parse(response.PolicyDocument);
                assert.equal(response_policy_document_json.Version, '2012-10-17');
                assert(Array.isArray(response_policy_document_json.Statement));
                assert.deepEqual(response_policy_document_json.Statement[0], { "Effect": "Allow", "Action": "*", "Resource": "*" });
            });

            mocha.it('delete user policy', async function() {
                const input = {
                    UserName: username3,
                    PolicyName: policy_name
                };
                const command = new DeleteUserPolicyCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });
        });

        mocha.describe('IAM User Tags API', async function() {
            if (is_nc_coretest) this.skip(); // eslint-disable-line no-invalid-this
            const username4 = 'Itsuki';
            const user_tag_1 = {
                Key: "CostCenter",
                Value: "12345"
            };
            const user_tag_2 = {
                Key: "Department",
                Value: "Accounting"
            };

            const user_tags = [user_tag_1, user_tag_2];

            mocha.before(async () => {
                // create a user
                const input = {
                    UserName: username4
                };
                const command = new CreateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.after(async () => {
                // delete a user
                const input = {
                    UserName: username4
                };
                const command = new DeleteUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.it('list user tags - should be empty', async function() {
                const input = {
                    UserName: username4,
                };
                const command = new ListUserTagsCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Tags.length, 0);
            });

            mocha.it('tag user', async function() {
                const input = {
                    UserName: username4,
                    Tags: user_tags
                };
                const command = new TagUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);

                // verify it using list user tags
                const input2 = {
                    UserName: username4
                };
                const command2 = new ListUserTagsCommand(input2);
                const response2 = await iam_account.send(command2);
                _check_status_code_ok(response2);
                assert.equal(response2.Tags.length, 2);
                const sorted = arr => _.sortBy(arr, 'Key');
                assert.deepEqual(sorted(response2.Tags), sorted(user_tags));

            // verify it with get user (Tags are included in the User object)
            const input3 = {
                UserName: username4
            };
            const command3 = new GetUserCommand(input3);
            const response3 = await iam_account.send(command3);
            _check_status_code_ok(response3);
            assert.equal(response3.User.Tags.length, 2);
            assert.deepEqual(sorted(response3.User.Tags), sorted(user_tags));
            });

            mocha.it('untag user', async function() {
                const input = {
                    UserName: username4,
                    TagKeys: [user_tag_2.Key]
                };
                const command = new UntagUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);

                // verify it using list user tags
                const input2 = {
                    UserName: username4
                };
                const command2 = new ListUserTagsCommand(input2);
                const response2 = await iam_account.send(command2);
                _check_status_code_ok(response2);
                assert.equal(response2.Tags.length, 1);
                assert.deepEqual(response2.Tags, [user_tag_1]);
            });
        });

        mocha.describe('IAM other APIs (currently returns empty value)', async function() {
            const username5 = 'Emi';
            const group_name = 'my_group';
            const role_name = 'my_role';
            const instance_profile_name = 'my_instance_profile_name';
            const policy_arn = 'arn:aws:iam::123456789012:policy/billing-access';

            mocha.before(async () => {
                // create a user
                const input = {
                    UserName: username5
                };
                const command = new CreateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.after(async () => {
                // delete a user
                const input = {
                    UserName: username5
                };
                const command = new DeleteUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.it('list groups for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListGroupsForUserCommand(input);
                    await iam_account.send(command);
                    assert.fail('list groups for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list groups for user - should be empty', async function() {
                const input = {
                    UserName: username5
                };
                const command = new ListGroupsForUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Groups.length, 0);
            });

            mocha.it('list account aliases - should be empty', async function() {
                const input = {};
                const command = new ListAccountAliasesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.AccountAliases.length, 0);
            });

            mocha.it('list attached group policies - should be empty', async function() {
                const input = {
                    GroupName: group_name
                };
                const command = new ListAttachedGroupPoliciesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.AttachedPolicies.length, 0);
            });

            mocha.it('list attached role policies - should be empty', async function() {
                const input = {
                    RoleName: role_name
                };
                const command = new ListAttachedRolePoliciesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.AttachedPolicies.length, 0);
            });

            mocha.it('list attached user policies for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListAttachedUserPoliciesCommand(input);
                    await iam_account.send(command);
                    assert.fail('list attached user policies for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list attached user policies for user - should be empty', async function() {
                const input = {
                    UserName: username5
                };
                const command = new ListAttachedUserPoliciesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.AttachedPolicies.length, 0);
            });

            mocha.it('list entities for policy - should throw an error', async function() {
                try {
                    const input = {
                        PolicyArn: 'arn:aws:iam::123456789012:policy/TestPolicy'
                    };
                    const command = new ListEntitiesForPolicyCommand(input);
                    await iam_account.send(command);
                    assert.fail('list entities for policy - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list group policies - should be empty', async function() {
                const input = {
                    GroupName: group_name
                };
                const command = new ListGroupPoliciesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.PolicyNames.length, 0);
            });

            mocha.it('list groups - should be empty', async function() {
                const input = {};
                const command = new ListGroupsCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Groups.length, 0);
            });

            mocha.it('list instance profiles - should be empty', async function() {
                const input = {};
                const command = new ListInstanceProfilesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.InstanceProfiles.length, 0);
            });

            mocha.it('list instances profiles for role - should throw an error', async function() {
                try {
                    const input = {
                        RoleName: role_name
                    };
                    const command = new ListInstanceProfilesForRoleCommand(input);
                    await iam_account.send(command);
                    assert.fail('list instances profiles for role - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list instances profiles tags - should throw an error', async function() {
                try {
                    const input = {
                        InstanceProfileName: instance_profile_name
                    };
                    const command = new ListInstanceProfileTagsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list instances profiles tags - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list MFA devices for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListMFADevicesCommand(input);
                    await iam_account.send(command);
                    assert.fail('list MFA devices for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list MFA devices for user - should be empty', async function() {
                const input = {
                    UserName: username5
                };
                const command = new ListMFADevicesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.MFADevices.length, 0);
            });

            mocha.it('list MFA devices (no user parameter) - should be empty', async function() {
                const input = {};
                const command = new ListMFADevicesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.MFADevices.length, 0);
            });

            mocha.it('list MFA device tags- should throw an error', async function() {
                try {
                    const input = {
                        SerialNumber: 'arn:aws:iam::123456789012:mfa/alice'
                    };
                    const command = new ListMFADeviceTagsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list MFA device tags - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list open ID connect providers - should be empty', async function() {
                const input = {};
                const command = new ListOpenIDConnectProvidersCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.OpenIDConnectProviderList.length, 0);
            });

            mocha.it('list open ID connect tags- should throw an error', async function() {
                try {
                    const input = {
                        OpenIDConnectProviderArn: 'arn:aws:iam::123456789012:mfa/alice'
                    };
                    const command = new ListOpenIDConnectProviderTagsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list open ID connect tags - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list policies - should be empty', async function() {
                const input = {};
                const command = new ListPoliciesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Policies.length, 0);
            });

            mocha.it('list policy tags - should throw an error', async function() {
                try {
                    const input = {
                        PolicyArn: policy_arn
                    };
                    const command = new ListPolicyTagsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list policy tags - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list policy versions - should throw an error', async function() {
                try {
                    const input = {
                        PolicyArn: policy_arn
                    };
                    const command = new ListPolicyVersionsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list policy versions - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list roles - should be empty', async function() {
                const input = {};
                const command = new ListRolesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Roles.length, 0);
            });

            mocha.it('list role tags - should throw an error', async function() {
                try {
                    const input = {
                        RoleName: role_name
                    };
                    const command = new ListRoleTagsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list role tags - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list SAML providers - should be empty', async function() {
                const input = {};
                const command = new ListSAMLProvidersCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.SAMLProviderList.length, 0);
            });

            mocha.it('list server certificates - should be empty', async function() {
                const input = {};
                const command = new ListServerCertificatesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.ServerCertificateMetadataList.length, 0);
            });

            mocha.it('list server certificate tags - should throw an error', async function() {
                try {
                    const input = {
                        ServerCertificateName: 'ExampleCertificate'
                    };
                    const command = new ListServerCertificateTagsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list server certificate tags - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list service specific credentials for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListServiceSpecificCredentialsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list service specific credentials for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list service specific credentials for user - should be empty', async function() {
                const input = {
                    UserName: username5
                };
                const command = new ListServiceSpecificCredentialsCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.ServiceSpecificCredentials.length, 0);
            });

            mocha.it('list service specific credentials (no user parameter) - should be empty', async function() {
                const input = {};
                const command = new ListServiceSpecificCredentialsCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.ServiceSpecificCredentials.length, 0);
            });

            mocha.it('list signing certificates for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListSigningCertificatesCommand(input);
                    await iam_account.send(command);
                    assert.fail('list signing certificates for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list signing certificates for user - should be empty', async function() {
                const input = {
                    UserName: username5
                };
                const command = new ListSigningCertificatesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Certificates.length, 0);
            });

            mocha.it('list signing certificates (no user parameter) - should be empty', async function() {
                const input = {};
                const command = new ListSigningCertificatesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Certificates.length, 0);
            });

            mocha.it('list SSH public keys for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListSSHPublicKeysCommand(input);
                    await iam_account.send(command);
                    assert.fail('list SSH public keys for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list SSH public keys for user - should be empty', async function() {
                const input = {
                    UserName: username5
                };
                const command = new ListSSHPublicKeysCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.SSHPublicKeys.length, 0);
            });

            mocha.it('list SSH public keys (no user parameter) - should be empty', async function() {
                const input = {};
                const command = new ListSSHPublicKeysCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.SSHPublicKeys.length, 0);
            });

            mocha.it('list user policies for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListUserPoliciesCommand(input);
                    await iam_account.send(command);
                    assert.fail('list user policies for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list user policies for user - should be empty', async function() {
                const input = {
                    UserName: username5
                };
                const command = new ListUserPoliciesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.PolicyNames.length, 0);
            });

            mocha.it('list user tags for non existing user - should throw an error', async function() {
                try {
                    const input = {
                        UserName: 'non-existing-user'
                    };
                    const command = new ListUserTagsCommand(input);
                    await iam_account.send(command);
                    assert.fail('list user tags for non existing user - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.NoSuchEntity.code);
                }
            });

            mocha.it('list user tags for user - should be empty', async function() {
                const input = {
                    UserName: username5
                };
                const command = new ListUserTagsCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.Tags.length, 0);
            });

            mocha.it('list virtual MFA devices - should be empty', async function() {
                const input = {};
                const command = new ListVirtualMFADevicesCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
                assert.equal(response.VirtualMFADevices.length, 0);
            });
        });
    });

    mocha.describe('IAM advanced integration tests', async function() {
        mocha.describe('IAM User API', async function() {
            const username = 'Mateo';
            const username_lowercase = username.toLowerCase();
            const username_uppercase = username.toUpperCase();
            const username2 = 'Leonardo';

            mocha.describe('IAM CreateUser API', async function() {
                mocha.before(async () => {
                    await create_iam_user(username);
                });

                mocha.after(async () => {
                    await delete_iam_user(username);
                });

                mocha.it('create a user with username that already exists should fail', async function() {
                    try {
                        const input = {
                            UserName: username
                        };
                        const command = new CreateUserCommand(input);
                        await iam_account.send(command);
                        assert.fail('create user with existing username - should throw an error');
                    } catch (err) {
                        const err_code = err.Error.Code;
                        assert.equal(err_code, IamError.EntityAlreadyExists.code);
                    }
                });

                mocha.it('create a user with username that already exists (lower case) should fail', async function() {
                    try {
                        const input = {
                            UserName: username_lowercase
                        };
                        const command = new CreateUserCommand(input);
                        await iam_account.send(command);
                        assert.fail('create user with existing username (lower case) - should throw an error');
                    } catch (err) {
                        const err_code = err.Error.Code;
                        assert.equal(err_code, IamError.EntityAlreadyExists.code);
                    }
                });

                mocha.it('create a user with username that already exists (upper case) should fail', async function() {
                    try {
                        const input = {
                            UserName: username_uppercase
                        };
                        const command = new CreateUserCommand(input);
                        await iam_account.send(command);
                        assert.fail('create user with existing username (upper case) - should throw an error');
                    } catch (err) {
                        const err_code = err.Error.Code;
                        assert.equal(err_code, IamError.EntityAlreadyExists.code);
                    }
                });
            });

            mocha.describe('IAM UpdateUser API', async function() {
                mocha.before(async () => {
                    // create 2 users
                    await create_iam_user(username);
                    await create_iam_user(username2);
                });

                mocha.after(async () => {
                    // delete 2 users
                    await delete_iam_user(username);
                    await delete_iam_user(username2);
                });

                mocha.it('update a user with same username', async function() {
                    const input = {
                        UserName: username2,
                        NewUserName: username2,
                    };
                    const command = new UpdateUserCommand(input);
                    const response = await iam_account.send(command);
                    _check_status_code_ok(response);
                });

                mocha.it('update a user with new username that already exists (lower case) should fail', async function() {
                    try {
                        const input = {
                            UserName: username2,
                            NewUserName: username_lowercase,
                        };
                        const command = new UpdateUserCommand(input);
                        await iam_account.send(command);
                        assert.fail('update user with existing username (lower case) - should throw an error');
                    } catch (err) {
                        const err_code = err.Error.Code;
                        assert.equal(err_code, IamError.EntityAlreadyExists.code);
                    }
                });

                mocha.it('update a user with new username that already exists (upper case) should fail', async function() {
                    try {
                        const input = {
                            UserName: username2,
                            NewUserName: username_uppercase,
                        };
                        const command = new UpdateUserCommand(input);
                        await iam_account.send(command);
                        assert.fail('update user with existing username (upper case) - should throw an error');
                    } catch (err) {
                        const err_code = err.Error.Code;
                        assert.equal(err_code, IamError.EntityAlreadyExists.code);
                    }
                });
            });

        });
    });
});

/**
 * _check_status_code_ok is an helper function to check that we got an response from the server
 * @param {{ $metadata: { httpStatusCode: number; }; }} response
 */
function _check_status_code_ok(response) {
    assert.equal(response.$metadata.httpStatusCode, 200);
}

/**
 * Create an IAM user with the given username.
 * use this function for before/after hooks to avoid code duplication
 * @param {string} username_to_create
 */
async function create_iam_user(username_to_create) {
    const input = {
        UserName: username_to_create
    };
    const command = new CreateUserCommand(input);
    const response = await iam_account.send(command);
    _check_status_code_ok(response);
}

/**
 * Delete an IAM user with the given username.
 *  use this function for before/after hooks to avoid code duplication
 * @param {string} username_to_delete
 */
async function delete_iam_user(username_to_delete) {
    const input = {
        UserName: username_to_delete
    };
    const command = new DeleteUserCommand(input);
    const response = await iam_account.send(command);
    _check_status_code_ok(response);
}
