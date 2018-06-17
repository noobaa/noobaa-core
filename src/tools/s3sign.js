/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const util = require('util');
const req = require('minimist')(process.argv.slice(2));

if (req.help) return usage();

// inherit functions from AWS.HttpRequest
Object.setPrototypeOf(req, AWS.HttpRequest.prototype);

// remove minimist non flag args
delete req._;

// set request defaults
req.method = req.method || 'GET';
req.path = req.path || '/';
req.region = req.region || 'us-east-1';
req.headers = req.headers || {};
req.headers.Date = req.headers.Date || AWS.util.date.rfc822();
req.credentials = req.credentials || {};
req.credentials.accessKeyId = req.credentials.accessKeyId || req.access_key || '123';
req.credentials.secretAccessKey = req.credentials.secretAccessKey || req.secret_key || 'abc';

console.log();
p('Request', req);

const date = new Date(req.headers.Date);
const signer_v2 = new AWS.Signers.S3(req);
signer_v2.addAuthorization(req.credentials, date);
p('V2 Authorization', req.headers.Authorization);
p('V2 stringToSign', signer_v2.stringToSign());

const signer_v4 = new AWS.Signers.V4(req, 's3', 'signatureCache');
signer_v4.addAuthorization(req.credentials, date);
p('V4 Authorization', req.headers.Authorization);
p('V4 stringToSign', signer_v4.stringToSign(AWS.util.date.iso8601(date)));

function p(title, value) {
    console.log(`*** ${title} ***`);
    console.log(util.inspect(value));
    console.log();
}

function usage() {
    console.log(`
Usage:
--method <HTTP-METHOD>      i.e. GET|HEAD|PUT|...
--path <HTTP-PATH>          i.e. /bucket/key
--region <AWS-REGION>       i.e. us-east-1
--access_key <KEY>
--secret_key <KEY>
--header.<NAME> <VALUE>

Example Headers:
--header.Host '10.0.0.1'
--header.Date 'Sat, 28 Apr 2018 06:26:22 GMT'
--header.User-Agent 'Smith'
`);
}
