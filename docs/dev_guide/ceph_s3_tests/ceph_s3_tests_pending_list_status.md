# Ceph S3 Tests - Pending List Status

## Introduction
Ceph S3 tests are unofficial AWS S3 compatibility tests written in Python (for more information see: [ceph/s3-test](https://github.com/ceph/s3-tests) repository on GitHub) that we use in our CI.

## Pending List Status
Attached a table with tests that where investigated and their status (this table is partial).

| Test (Partial Name)                                       | General Reason | Issue Number         | Additional Comments  |
|-----------------------------------------------------------|-----------------|----------------------|----------------------|
| test_bucket_create_exists                                 | Faulty Test     | [465](https://github.com/ceph/s3-tests/issues/465)                  |                      |
| test_bucket_listv2_encoding_basic                         | Faulty Test     | [478](https://github.com/ceph/s3-tests/issues/478)                  |                      |
| test_bucket_list_encoding_basic                           | Faulty Test     | [478](https://github.com/ceph/s3-tests/issues/478)                  |                      |
| test_object_read_unreadable                               | Faulty Test     | [480](https://github.com/ceph/s3-tests/issues/480)                  |                      |
| test_account_usage                                        | Not Supported   |                      | Noobaa list_buckets() don't have support for usage                     |
| test_head_bucket_usage                                        | Not Supported   |                      | Noobaa list_buckets() don't have support for usage                     |
| test_head_bucket_usage                                        | Not Supported   |                      | S3 test expecting Prefix inside rules not inside Filter, But in our code Prefix expected inside Filter                     |
| test_post_object_invalid_signature                        | Not Implemented |                      |                      |
| test_post_object_invalid_access_key                       | Not Implemented |                      |                      |
| test_post_object_missing_policy_condition                 | Not Implemented |                      |                      |
| test_post_object_expired_policy                           | Not Implemented |                      |                      |
| test_post_object_request_missing_policy_specified_field   | Not Implemented |                      |                      |
| test_post_object_invalid_request_field_value              | Not Implemented |                      |                      |
| test_bucket_recreate_overwrite_acl                        | Not Implemented |                      |                      |
| test_bucket_recreate_new_acl                              | Not Implemented |                      |                      |
| test_list_multipart_upload_owner                          | Not Implemented |                      |                      |
| test_get_public_acl_bucket_policy_status                  | Not Implemented |                      |                      |
| test_get_authpublic_acl_bucket_policy_status              | Not Implemented |                      |                      |
| test_get_publicpolicy_acl_bucket_policy_status            | Not Implemented |                      |                      |
| test_get_nonpublicpolicy_acl_bucket_policy_status         | Not Implemented |                      |                      |
| test_block_public_put_bucket_acls                         | Not Implemented |                      |                      |
| test_block_public_object_canned_acls                      | Not Implemented |                      |                      |
| test_ignore_public_acls                                   | Not Implemented |                      |                      |
| test_generate_projection                                  | Faulty Test     | [509](https://github.com/ceph/s3-tests/issues/509)                    |                      |
| test_alias_cyclic_refernce                                | Faulty Test     |                      | Stops execution after failure is returned instead of parsing error. I'm not opening issue as it might be related to outdated tests.                     |
| test_schema_definition                                    | Faulty Test     |                      | Same as test_alias_cyclic_refernce |
| test_progress_expressions                                 | Faulty Test     | [508](https://github.com/ceph/s3-tests/issues/508)                    |                      |
| test_lifecycle_set_date                                   | Faulty Test     | [510](https://github.com/ceph/s3-tests/issues/510)                    |                      |
| test_lifecycle_transition_set_invalid_date                | Not Implemented |                      |    added because of the following PR [7270](https://github.com/noobaa/noobaa-core/pull/7270#discussion_r1175123422)   |
| All aws4 tests (e.g test_bucket_create_bad_amz_date_before_epoch_aws4)                                   | Faulty Test     | [520](https://github.com/ceph/s3-tests/issues/520)                    |                      |
| test_object_create_bad_authorization_none                 | Internal Component | [438](https://github.com/ceph/s3-tests/issues/438)                    | It used to pass in the past (not related to code change in our repo) |
| test_bucket_create_bad_contentlength_empty                | Internal Component | [438](https://github.com/ceph/s3-tests/issues/438)                    | It used to pass in the past (not related to code change in our repo) |
| test_bucket_create_bad_authorization_empty                | Internal Component | [438](https://github.com/ceph/s3-tests/issues/438)                    | It used to pass in the past (not related to code change in our repo) |
| test_bucket_create_bad_authorization_none                 | Internal Component | [438](https://github.com/ceph/s3-tests/issues/438)                    | It used to pass in the past (not related to code change in our repo) |
| test_object_create_bad_authorization_incorrect_aws2       | Internal Component | [438](https://github.com/ceph/s3-tests/issues/438)                    | It used to pass in the past (not related to code change in our repo) |
| test_object_create_bad_date_none_aws2                     | Internal Component | [438](https://github.com/ceph/s3-tests/issues/438)                    | It used to pass in the past (not related to code change in our repo) |
| test_bucket_create_bad_authorization_invalid_aws2         | Internal Component | [438](https://github.com/ceph/s3-tests/issues/438)                    | It used to pass in the past (not related to code change in our repo) |
| test_bucket_create_bad_date_none_aws2                     | Internal Component | [438](https://github.com/ceph/s3-tests/issues/438)                    | It used to pass in the past (not related to code change in our repo) |
| test_get_object_ifnonematch_good                     | Internal Component |                    | It used to pass in the past (not related to code 
change in our repo) - stopped passing between the update of commit hash 6861c3d81081a6883fb90d66cb60392e1abdf3ca to da91ad8bbf899c72199df35b69e9393c706aabee |
| test_get_object_ifmodifiedsince_failed                     | Internal Component |                    | It used to pass in the past (not related to code 
change in our repo) - stopped passing between the update of commit hash 6861c3d81081a6883fb90d66cb60392e1abdf3ca to da91ad8bbf899c72199df35b69e9393c706aabee |
| test_versioning_concurrent_multi_object_delete | Faulty Test | [588](https://github.com/ceph/s3-tests/issues/588) | 
| test_get_bucket_encryption_s3 | Faulty Test | [613](https://github.com/ceph/s3-tests/issues/613) | 
| test_get_bucket_encryption_kms | Faulty Test | [613](https://github.com/ceph/s3-tests/issues/613) | 
| test_delete_bucket_encryption_s3 | Faulty Test | [613](https://github.com/ceph/s3-tests/issues/613) | 
| test_delete_bucket_encryption_kms | Faulty Test | [613](https://github.com/ceph/s3-tests/issues/613) |
| test_lifecycle_expiration_tags1 | Faulty Test | [638](https://github.com/ceph/s3-tests/issues/638) | There can be more such tests having the same issue (`Filter` is not aligned with aws structure in bucket lifecycle configuration) |