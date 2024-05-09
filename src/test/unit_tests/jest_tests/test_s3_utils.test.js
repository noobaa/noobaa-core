/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../../../endpoint/s3/s3_utils');
const { S3Error } = require('../../../endpoint/s3/s3_errors');
const config = require('../../../../config');

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
});
