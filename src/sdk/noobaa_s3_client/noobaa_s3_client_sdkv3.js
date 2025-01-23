/* Copyright (C) 2023 NooBaa */
'use strict';

const { S3 } = require('@aws-sdk/client-s3');
const dbg = require('../../util/debug_module')(__filename);

/**
 * Same as S3Client but wraps the send method to resubmit the request with the correct region
 * if the server responds that another region should be used.
 * 
 * S3 Interface, S3 Class and operations in AWS SDK V3:
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Interface/S3/
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Class/S3/
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
 */
class S3ClientAutoRegion extends S3 {

    /**
     * Overriding the send method by wrapping it and fixing the region if the error indicates it.
     * All the methods of the base class call send() to submit an SDK command.
     * @override
     */
    async send(...args) {
        try {
            const res = await super.send(...args);
            return res;
        } catch (err) {
            const region = err.$response?.headers?.['x-amz-bucket-region'];
            if (!region) throw err;
            dbg.log0(`Updating region to new region ${region} in bucket ${args[0].input.Bucket}, will call ${args[0].constructor.name} again with the new region`);
            this.config.region = async () => region;
            const res = await super.send(...args);
            return res;
        }
    }
}

// EXPORTS
exports.S3ClientAutoRegion = S3ClientAutoRegion;
