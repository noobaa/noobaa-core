'use strict';

const _ = require('lodash');
const xml_utils = require('../util/xml_utils');

class S3Error {

    constructor(err) {
        this.code = err.code;
        this.message = err.message;
        this.http_code = err.http_code;
        if (err.reply) {
            this.reply = err.reply;
        }
    }

    reply(resource, request_id) {
        return xml_utils.encode_xml({
            Error: {
                Code: this.code,
                Message: this.message,
                Resource: resource || '',
                RequestId: request_id || ''
            }
        });
    }

}

// See http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html

const errors_defs = [{
    code: 'AccessDenied',
    message: 'Access Denied',
    http_code: 403,
}, {
    code: 'AccountProblem',
    message: 'There is a problem with your AWS account that prevents the operation from completing successfully. Please Contact Us.',
    http_code: 403,
}, {
    code: 'AmbiguousGrantByEmailAddress',
    message: 'The email address you provided is associated with more than one account.',
    http_code: 400,
}, {
    code: 'BadDigest',
    message: 'The Content-MD5 you specified did not match what we received.',
    http_code: 400,
}, {
    code: 'BucketAlreadyExists',
    message: 'The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.',
    http_code: 409,
}, {
    code: 'BucketAlreadyOwnedByYou',
    message: 'Your previous request to create the named bucket succeeded and you already own it. You get this error in all AWS regions except US East (N. Virginia) region, us-east-1. In us-east-1 region, you will get 200 OK, but it is no-op (if bucket exists it Amazon S3 will not do anything).',
    http_code: 409,
}, {
    code: 'BucketNotEmpty',
    message: 'The bucket you tried to delete is not empty.',
    http_code: 409,
}, {
    code: 'CredentialsNotSupported',
    message: 'This request does not support credentials.',
    http_code: 400,
}, {
    code: 'CrossLocationLoggingProhibited',
    message: 'Cross-location logging not allowed. Buckets in one geographic location cannot log information to a bucket in another location.',
    http_code: 403,
}, {
    code: 'EntityTooSmall',
    message: 'Your proposed upload is smaller than the minimum allowed object size.',
    http_code: 400,
}, {
    code: 'EntityTooLarge',
    message: 'Your proposed upload exceeds the maximum allowed object size.',
    http_code: 400,
}, {
    code: 'ExpiredToken',
    message: 'The provided token has expired.',
    http_code: 400,
}, {
    code: 'IllegalVersioningConfigurationException',
    message: 'Indicates that the versioning configuration specified in the request is invalid.',
    http_code: 400,
}, {
    code: 'IncompleteBody',
    message: 'You did not provide the number of bytes specified by the Content-Length HTTP header',
    http_code: 400,
}, {
    code: 'IncorrectNumberOfFilesInPostRequest',
    message: 'POST requires exactly one file upload per request.',
    http_code: 400,
}, {
    code: 'InlineDataTooLarge',
    message: 'Inline data exceeds the maximum allowed size.',
    http_code: 400,
}, {
    code: 'InternalError',
    message: 'We encountered an internal error. Please try again.',
    http_code: 500,
}, {
    code: 'InvalidAccessKeyId',
    message: 'The AWS access key Id you provided does not exist in our records.',
    http_code: 403,
}, {
    code: 'InvalidAddressingHeader',
    message: 'You must specify the Anonymous role.',
    http_code: 400, // N/A,
}, {
    code: 'InvalidArgument',
    message: 'Invalid Argument',
    http_code: 400,
}, {
    code: 'InvalidBucketName',
    message: 'The specified bucket is not valid.',
    http_code: 400,
}, {
    code: 'InvalidBucketState',
    message: 'The request is not valid with the current state of the bucket.',
    http_code: 409,
}, {
    code: 'InvalidDigest',
    message: 'The Content-MD5 you specified is not valid.',
    http_code: 400,
}, {
    code: 'InvalidEncryptionAlgorithmError',
    message: 'The encryption request you specified is not valid. The valid value is AES256.',
    http_code: 400,
}, {
    code: 'InvalidLocationConstraint',
    message: 'The specified location constraint is not valid. For more information about regions, see How to Select a Region for Your Buckets.',
    http_code: 400,
}, {
    code: 'InvalidObjectState',
    message: 'The operation is not valid for the current state of the object.',
    http_code: 403,
}, {
    code: 'InvalidPart',
    message: 'One or more of the specified parts could not be found. The part might not have been uploaded, or the specified entity tag might not have matched the part\'s entity tag.',
    http_code: 400,
}, {
    code: 'InvalidPartOrder',
    message: 'The list of parts was not in ascending order.Parts list must specified in order by part number.',
    http_code: 400,
}, {
    code: 'InvalidPayer',
    message: 'All access to this object has been disabled.',
    http_code: 403,
}, {
    code: 'InvalidPolicyDocument',
    message: 'The content of the form does not meet the conditions specified in the policy document.',
    http_code: 400,
}, {
    code: 'InvalidRange',
    message: 'The requested range cannot be satisfied.',
    http_code: 416,
}, {
    code: 'InvalidRequest',
    message: 'SOAP requests must be made over an HTTPS connection.',
    http_code: 400,
}, {
    code: 'InvalidSecurity',
    message: 'The provided security credentials are not valid.',
    http_code: 403,
}, {
    code: 'InvalidSOAPRequest',
    message: 'The SOAP request body is invalid.',
    http_code: 400,
}, {
    code: 'InvalidStorageClass',
    message: 'The storage class you specified is not valid.',
    http_code: 400,
}, {
    code: 'InvalidTargetBucketForLogging',
    message: 'The target bucket for logging does not exist, is not owned by you, or does not have the appropriate grants for the log-delivery group.',
    http_code: 400,
}, {
    code: 'InvalidToken',
    message: 'The provided token is malformed or otherwise invalid.',
    http_code: 400,
}, {
    code: 'InvalidURI',
    message: 'Couldn\'t parse the specified URI.',
    http_code: 400,
}, {
    code: 'KeyTooLong',
    message: 'Your key is too long.',
    http_code: 400,
}, {
    code: 'MalformedACLError',
    message: 'The XML you provided was not well-formed or did not validate against our published schema.',
    http_code: 400,
}, {
    code: 'MalformedPOSTRequest',
    message: 'The body of your POST request is not well-formed multipart/form-data.',
    http_code: 400,
}, {
    code: 'MalformedXML',
    message: 'This happens when the user sends malformed xml (xml that doesn\'t conform to the published xsd) for the configuration. The error message is, "The XML you provided was not well-formed or did not validate against our published schema."',
    http_code: 400,
}, {
    code: 'MaxMessageLengthExceeded',
    message: 'Your request was too big.',
    http_code: 400,
}, {
    code: 'MaxPostPreDataLengthExceededError',
    message: 'Your POST request fields preceding the upload file were too large.',
    http_code: 400,
}, {
    code: 'MetadataTooLarge',
    message: 'Your metadata headers exceed the maximum allowed metadata size.',
    http_code: 400,
}, {
    code: 'MethodNotAllowed',
    message: 'The specified method is not allowed against this resource.',
    http_code: 405,
}, {
    code: 'MissingAttachment',
    message: 'A SOAP attachment was expected, but none were found.',
    http_code: 400, // N/A,
}, {
    code: 'MissingContentLength',
    message: 'You must provide the Content-Length HTTP header.',
    http_code: 400,
    // http_code: 411, // 411 is HTTP "Length Required" but s3-tests require 400
}, {
    code: 'MissingRequestBodyError',
    message: 'This happens when the user sends an empty xml document as a request. The error message is "Request body is empty."',
    http_code: 400,
}, {
    code: 'MissingSecurityElement',
    message: 'The SOAP 1.1 request is missing a security element.',
    http_code: 400,
}, {
    code: 'MissingSecurityHeader',
    message: 'Your request is missing a required header.',
    http_code: 400,
}, {
    code: 'NoLoggingStatusForKey',
    message: 'There is no such thing as a logging status subresource for a key.',
    http_code: 400,
}, {
    code: 'NoSuchBucket',
    message: 'The specified bucket does not exist.',
    http_code: 404,
}, {
    code: 'NoSuchKey',
    message: 'The specified key does not exist.',
    http_code: 404,
}, {
    code: 'NoSuchLifecycleConfiguration',
    message: 'The lifecycle configuration does not exist.',
    http_code: 404,
}, {
    code: 'NoSuchUpload',
    message: 'The specified multipart upload does not exist. The upload ID might be invalid, or the multipart upload might have been aborted or completed.',
    http_code: 404,
}, {
    code: 'NoSuchVersion',
    message: 'Indicates that the version ID specified in the request does not match an existing version.',
    http_code: 404,
}, {
    code: 'NotImplemented',
    message: 'A header you provided implies functionality that is not implemented.',
    http_code: 501,
}, {
    code: 'NotSignedUp',
    message: 'Your account is not signed up for the Amazon S3 service. You must sign up before you can use, Amazon S3. You can sign up at the following URL: http://aws.amazon.com/s3',
    http_code: 403,
}, {
    code: 'NoSuchBucketPolicy',
    message: 'The specified bucket does not have a bucket policy.',
    http_code: 404,
}, {
    code: 'OperationAborted',
    message: 'A conflicting conditional operation is currently in progress against this resource. Try again.',
    http_code: 409,
}, {
    code: 'PermanentRedirect',
    message: 'The bucket you are attempting to access must be addressed using the specified endpoint. Send all future requests to this endpoint.',
    http_code: 301,
}, {
    code: 'PreconditionFailed',
    message: 'At least one of the preconditions you specified did not hold.',
    http_code: 412,
}, {
    code: 'Redirect',
    message: 'Temporary redirect.',
    http_code: 307,
}, {
    code: 'RestoreAlreadyInProgress',
    message: 'Object restore is already in progress.',
    http_code: 409,
}, {
    code: 'RequestIsNotMultiPartContent',
    message: 'Bucket POST must be of the enclosure-type multipart/form-data.',
    http_code: 400,
}, {
    code: 'RequestTimeout',
    message: 'Your socket connection to the server was not read from or written to within the timeout period.',
    http_code: 400,
}, {
    code: 'RequestTimeTooSkewed',
    message: 'The difference between the request time and the server\'s time is too large.',
    http_code: 403,
}, {
    code: 'RequestTorrentOfBucketError',
    message: 'Requesting the torrent file of a bucket is not permitted.',
    http_code: 400,
}, {
    code: 'SignatureDoesNotMatch',
    message: 'The request signature we calculated does not match the signature you provided. Check your AWS secret access key and signing method. For more information, see REST Authentication and SOAP Authentication for details.',
    http_code: 403,
}, {
    code: 'ServiceUnavailable',
    message: 'Reduce your request rate.',
    http_code: 503,
}, {
    code: 'SlowDown',
    message: 'Reduce your request rate.',
    http_code: 503,
}, {
    code: 'TemporaryRedirect',
    message: 'You are being redirected to the bucket while DNS updates.',
    http_code: 307,
}, {
    code: 'TokenRefreshRequired',
    message: 'The provided token must be refreshed.',
    http_code: 400,
}, {
    code: 'TooManyBuckets',
    message: 'You have attempted to create more buckets than allowed.',
    http_code: 400,
}, {
    code: 'UnexpectedContent',
    message: 'This request does not support content.',
    http_code: 400,
}, {
    code: 'UnresolvableGrantByEmailAddress',
    message: 'The email address you provided does not match any account on record.',
    http_code: 400,
}, {
    code: 'UserKeyMustBeSpecified',
    message: 'The bucket POST must contain the specified field name. If it is specified, check the order of the fields.',
    http_code: 400,
}, {
    // not defined in AWS list, but defined in the protocol handling
    code: 'NotModified',
    message: 'The resource was not modified according to the conditions in the provided headers.',
    http_code: 304,
}];

// return a map of code -> error object
const errors_map = _.mapValues(
    _.keyBy(errors_defs, 'code'),
    err => new S3Error(err)
);

errors_map.S3Error = S3Error;

module.exports = errors_map;
