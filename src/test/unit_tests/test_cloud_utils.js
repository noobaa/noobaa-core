/* Copyright (C) 2020 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const sinon = require('sinon');
const AWS = require('aws-sdk');
const cloud_utils = require('../../util/cloud_utils');
const dbg = require('../../util/debug_module')(__filename);
const fs = require("fs");
const projectedServiceAccountToken = "/var/run/secrets/openshift/serviceaccount/oidc-token";
const fakeAccessKeyId = "fakeAccessKeyId";
const fakeSecretAccessKey = "fakeSecretAccessKey";
const fakeSessionToken = "fakeSessionToken";
const roleArn = "arn:aws:iam::261532230807:role/noobaa_s3_sts";
const defaultSTSCredsValidity = 3600;
const expectedParams = [{
    RoleArn: roleArn,
    RoleSessionName: 'testSession',
    WebIdentityToken: 'web-identity-token',
    DurationSeconds: defaultSTSCredsValidity,
}];
mocha.describe('AWS STS tests', function() {
    let STSStub;
    let stsFake;
    mocha.before('Creating STS stub', function() {
        sinon.stub(fs.promises, "readFile")
            .withArgs(projectedServiceAccountToken)
            .returns("web-identity-token");
        stsFake = {
        assumeRoleWithWebIdentity: sinon.stub().returnsThis(),
        promise: sinon.stub()
        .resolves({
            Credentials: {
                AccessKeyId: fakeAccessKeyId,
                SecretAccessKey: fakeSecretAccessKey,
                SessionToken: fakeSessionToken
            }
        }),
    };
        STSStub = sinon.stub(AWS, 'STS')
            .callsFake(() => stsFake);
    });
    mocha.after('Restoring STS stub', function() {
        STSStub.restore();
    });
    mocha.it('should generate aws sts creds', async function() {
        const params = {
            aws_sts_arn: roleArn
        };
        const roleSessionName = "testSession";
        const json = await cloud_utils.generate_aws_sts_creds(params, roleSessionName);
        sinon.assert.calledOnce(STSStub);
        sinon.assert.calledWith(stsFake.assumeRoleWithWebIdentity, ...expectedParams);
        assert.equal(json.accessKeyId, fakeAccessKeyId);
        assert.equal(json.secretAccessKey, fakeSecretAccessKey);
        assert.equal(json.sessionToken, fakeSessionToken);
        dbg.log0('test.aws.sts.assumeRoleWithWebIdentity: ', json);
    });
    mocha.it('should generate an STS S3 client', async function() {
        const params = {
            aws_sts_arn: roleArn,
            region: 'us-east-1'
        };
        const additionalParams = {
            RoleSessionName: 'testSession'
        };
        const s3 = await cloud_utils.createSTSS3Client(params, additionalParams);
        dbg.log0('test.aws.sts.createSTSS3Client: ', s3);
        assert.equal(s3.config.credentials.accessKeyId, fakeAccessKeyId);
        assert.equal(s3.config.credentials.secretAccessKey, fakeSecretAccessKey);
        assert.equal(s3.config.credentials.sessionToken, fakeSessionToken);
        assert.equal(s3.config.region, 'us-east-1');
    });
});
