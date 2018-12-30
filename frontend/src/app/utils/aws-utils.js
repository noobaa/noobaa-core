/* Copyright (C) 2016 NooBaa */

export function createS3Client(AWS, connection) {
    const { endpoint, accessKey, secretKey } = connection;
    return new AWS.S3({
        endpoint: endpoint,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        },
        s3ForcePathStyle: true,
        sslEnabled: false
    });
}
