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
| test_generate_where_clause                                | Not Implemented |                      |                      |
| test_generate_projection                                  | Not Implemented |                      |                      |
| test_count_operation                                      | Not Implemented |                      |                      |
| test_column_sum_min_max                                   | Not Implemented |                      |                      |
| test_nullif_expressions                                   | Not Implemented |                      |                      |
| test_nulliftrue_expressions                               | Not Implemented |                      |                      |
| test_lowerupper_expressions                               | Not Implemented |                      |                      |
| test_in_expressions                                       | Not Implemented |                      |                      |
| test_is_not_null_expressions                              | Not Implemented |                      |                      |
| test_true_false_in_expressions                            | Not Implemented |                      |                      |
| test_like_expressions                                     | Not Implemented |                      |                      |
| test_truefalselike_expressions                            | Not Implemented |                      |                      |
| test_alias                                                | Not Implemented |                      |                      |
| test_complex_expressions                                  | Not Implemented |                      |                      |
| test_datetime                                             | Not Implemented |                      |                      |
| test_alias_cyclic_refernce                                | Not Implemented |                      |                      |
| test_csv_parser                                           | Not Implemented |                      |                      |
| test_csv_definition                                       | Not Implemented |                      |                      |
| test_true_false_datetime                                  | Not Implemented |                      |                      |
| test_schema_definition                                    | Not Implemented |                      |                      |
| test_when_then_else_expressions                           | Not Implemented |                      |                      |
| test_coalesce_expressions                                 | Not Implemented |                      |                      |
| test_trim_expressions                                     | Not Implemented |                      |                      |
| test_cast_expressions                                     | Not Implemented |                      |                      |
| test_version                                              | Not Implemented |                      |                      |
| test_truefalse_trim_expressions                           | Not Implemented |                      |                      |
| test_escape_expressions                                   | Not Implemented |                      |                      |
| test_bool_cast_expressions                                | Not Implemented |                      |                      |
| test_case_value_expressions                               | Not Implemented |                      |                      |
| test_progress_expressions                                 | Not Implemented |                      |                      |
| test_output_serial_expressions                            | Not Implemented |                      |                      |