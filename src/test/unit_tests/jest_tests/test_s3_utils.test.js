/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../../../endpoint/s3/s3_utils');
const { S3Error } = require('../../../endpoint/s3/s3_errors');
const config = require('../../../../config');

function create_dummy_nb_response() {
    return {
        headers: {},
        setHeader: function(k, v) {
            if (Array.isArray(v)) {
                v = v.join(',');
            }

            this.headers[k] = v;
        }
    };
}

describe('s3_utils', () => {
    describe('parse_restrore_request_days', () => {
        it('should parse correctly when 0 < days < max days', () => {
            const req = {
                body: {
                    RestoreRequest: { Days: [1] }
                }
            };

            const days = s3_utils.parse_restore_request_days(req);
            expect(days).toBe(1);
        });

        it('should fail when days < 1', () => {
            const req = {
                body: {
                    RestoreRequest: { Days: [0] }
                }
            };

            expect(() => s3_utils.parse_restore_request_days(req)).toThrow(S3Error);
        });

        it('should fail when days > max_days - behaviour DENY', () => {
            const req = {
                body: {
                    RestoreRequest: { Days: [config.S3_RESTORE_REQUEST_MAX_DAYS + 1] }
                }
            };

            const initial = config.S3_RESTORE_REQUEST_MAX_DAYS_BEHAVIOUR;
            config.S3_RESTORE_REQUEST_MAX_DAYS_BEHAVIOUR = 'DENY';
            expect(() => s3_utils.parse_restore_request_days(req)).toThrow(S3Error);
            config.S3_RESTORE_REQUEST_MAX_DAYS_BEHAVIOUR = initial;
        });

        it('should succeed when days > max_days - behaviour TRUNCATE', () => {
            const req = {
                body: {
                    RestoreRequest: { Days: [config.S3_RESTORE_REQUEST_MAX_DAYS + 1] }
                }
            };

            const initial = config.S3_RESTORE_REQUEST_MAX_DAYS_BEHAVIOUR;
            config.S3_RESTORE_REQUEST_MAX_DAYS_BEHAVIOUR = 'TRUNCATE';

            const days = s3_utils.parse_restore_request_days(req);
            expect(days).toBe(config.S3_RESTORE_REQUEST_MAX_DAYS);

            config.S3_RESTORE_REQUEST_MAX_DAYS_BEHAVIOUR = initial;
        });
    });

    describe('set_response_object_md', () => {
        it('should return no restore status when restore_status is absent', () => {
            const object_md = {
                xattr: {}
            };
            const res = create_dummy_nb_response();

            // @ts-ignore
            s3_utils.set_response_object_md(res, object_md);

            expect(res.headers['x-amz-restore']).toBeUndefined();
        });

        it('should return restore status when restore is requested and ongoing', () => {
            const object_md = {
                xattr: {},
                restore_status: {
                    ongoing: true,
                },
            };
            const res = create_dummy_nb_response();

            // @ts-ignore
            s3_utils.set_response_object_md(res, object_md);

            expect(res.headers['x-amz-restore']).toBeDefined();
        });

        it('should return restore status when restore is completed', () => {
            const object_md = {
                xattr: {},
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(),
                },
            };
            const res = create_dummy_nb_response();

            // @ts-ignore
            s3_utils.set_response_object_md(res, object_md);

            expect(res.headers['x-amz-restore']).toBeDefined();
        });
    });

    describe('parse_body_public_access_block', () => {
        it('should throw error if config has ACL', () => {
            const req = {
                body: {
                    PublicAccessBlockConfiguration: {
                        BlockPublicAcls: true
                    }
                }
            };
            expect(() => {
                s3_utils.parse_body_public_access_block(req);
            }).toThrow();

            req.body.PublicAccessBlockConfiguration.BlockPublicAcls = false;
            req.body.PublicAccessBlockConfiguration.IgnorePublicAcls = true;
            expect(() => {
                s3_utils.parse_body_public_access_block(req);
            }).toThrow();

            req.body.PublicAccessBlockConfiguration.BlockPublicAcls = true;
            req.body.PublicAccessBlockConfiguration.IgnorePublicAcls = true;
            expect(() => {
                s3_utils.parse_body_public_access_block(req);
            }).toThrow();
        });

        it('should throw error if it is Malformed XML', () => {
            const req = {};
            expect(() => {
                s3_utils.parse_body_public_access_block(req);
            }).toThrow();

            req.body = {};
            expect(() => {
                s3_utils.parse_body_public_access_block(req);
            }).toThrow();
        });

        it('should parse properly when XML is well formatted', () => {
            const req = {
                body: {
                    PublicAccessBlockConfiguration: {
                        BlockPublicPolicy: ["TRUE"]
                    }
                }
            };

            let res = s3_utils.parse_body_public_access_block(req);
            expect(res.block_public_policy).toBe(true);
            expect(res.restrict_public_buckets).toBe(undefined);

            req.body = {
                // @ts-ignore
                PublicAccessBlockConfiguration: {
                    RestrictPublicBuckets: ["TRUE"]
                }
            };
            res = s3_utils.parse_body_public_access_block(req);
            expect(res.block_public_policy).toBe(undefined);
            expect(res.restrict_public_buckets).toBe(true);

            req.body = {
                // @ts-ignore
                PublicAccessBlockConfiguration: {
                    BlockPublicPolicy: ["TRUE"],
                    RestrictPublicBuckets: ["TRUE"]
                }
            };
            res = s3_utils.parse_body_public_access_block(req);
            expect(res.block_public_policy).toBe(true);
            expect(res.restrict_public_buckets).toBe(true);

            req.body = {
                // @ts-ignore
                PublicAccessBlockConfiguration: {
                    BlockPublicPolicy: ["FALSE"],
                    RestrictPublicBuckets: ["FALSE"]
                }
            };
            res = s3_utils.parse_body_public_access_block(req);
            expect(res.block_public_policy).toBe(false);
            expect(res.restrict_public_buckets).toBe(false);
        });
    });

    describe('response_field_encoder_url', () => {
        it('should return undefined value', () => {
            const value = undefined;
            const field_encoded = s3_utils.response_field_encoder_url(value);
            expect(field_encoded).toBe(undefined);
            expect(typeof field_encoded).not.toBe('string');

        });
        it('should encode value without spaces (no special characters)', () => {
            const value = 'test';
            const field_encoded = s3_utils.response_field_encoder_url(value);
            expect(typeof field_encoded).toBe('string');
            expect(field_encoded).toBe(value);
        });
        it('should encode value without spaces (with special characters)', () => {
            const value = 'photos/';
            const field_encoded = s3_utils.response_field_encoder_url(value);
            expect(typeof field_encoded).toBe('string');
            expect(field_encoded).toBe('photos%2F');
        });
        it('should encode value with spaces', () => {
            const value = 'my test';
            const field_encoded = s3_utils.response_field_encoder_url(value);
            expect(typeof field_encoded).toBe('string');
            expect(field_encoded).toBe('my+test');
        });
    });
});
