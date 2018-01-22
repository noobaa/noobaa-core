/* Copyright (C) 2016 NooBaa */

export function createS3Client(S3, endpoint, accessKey, secretKey) {
    return new S3({
        endpoint: endpoint,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        },
        s3ForcePathStyle: true,
        sslEnabled: false
    });
}
