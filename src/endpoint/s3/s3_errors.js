/* Copyright (C) 2016 NooBaa */
'use strict';

const xml_utils = require('../../util/xml_utils');

/**
 * @typedef {{
 *      code?: string, 
 *      message: string, 
 *      http_code: number,
 *      detail?: string
 * }} S3ErrorSpec
 */

class S3Error extends Error {

    /**
     * @param {S3ErrorSpec} error_spec 
     * @param {string} [message_override] if provided, this will be used as the message instead of the default one from error_spec, but the code and http_code will still be from error_spec. 
     * This is needed for some cases like MalformedPolicy where AWS returns the same error code but with different messages depending on the exact error in the policy document, 
     * and we want to preserve the exact message from AWS for better compatibility with s3-tests.  
     */
    constructor({ code, message, http_code, detail }, message_override) {
        super(message_override || message); // sets this.message
        this.code = code;
        this.http_code = http_code;
        this.detail = detail;
    }

    reply(resource, request_id) {
        const xml = {
            Error: {
                Code: this.code,
                Message: this.message,
                Resource: resource || '',
                RequestId: request_id || '',
                Detail: this.detail,
            }
        };
        return xml_utils.encode_xml(xml);
    }

}

// See http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html

//////////////////////////////////////////
// Errors documented in AWS error pages //
//////////////////////////////////////////
S3Error.AccessDenied = Object.freeze({
    code: 'AccessDenied',
    message: 'Access Denied',
    http_code: 403,
});
S3Error.AccountProblem = Object.freeze({
    code: 'AccountProblem',
    message: 'There is a problem with your AWS account that prevents the operation from completing successfully. Please Contact Us.',
    http_code: 403,
});
S3Error.AmbiguousGrantByEmailAddress = Object.freeze({
    code: 'AmbiguousGrantByEmailAddress',
    message: 'The email address you provided is associated with more than one account.',
    http_code: 400,
});
S3Error.BadDigest = Object.freeze({
    code: 'BadDigest',
    message: 'The Content-MD5 you specified did not match what we received.',
    http_code: 400,
});
S3Error.BucketAlreadyExists = Object.freeze({
    code: 'BucketAlreadyExists',
    message: 'The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.',
    http_code: 409,
});
S3Error.BucketAlreadyOwnedByYou = Object.freeze({
    code: 'BucketAlreadyOwnedByYou',
    message: 'Your previous request to create the named bucket succeeded and you already own it. You get this error in all AWS regions except US East (N. Virginia) region, us-east-1. In us-east-1 region, you will get 200 OK, but it is no-op (if bucket exists it Amazon S3 will not do anything).',
    http_code: 409,
});
S3Error.BucketNotEmpty = Object.freeze({
    code: 'BucketNotEmpty',
    message: 'The bucket you tried to delete is not empty. You must delete all versions in the bucket.',
    http_code: 409,
});
S3Error.CredentialsNotSupported = Object.freeze({
    code: 'CredentialsNotSupported',
    message: 'This request does not support credentials.',
    http_code: 400,
});
S3Error.CrossLocationLoggingProhibited = Object.freeze({
    code: 'CrossLocationLoggingProhibited',
    message: 'Cross-location logging not allowed. Buckets in one geographic location cannot log information to a bucket in another location.',
    http_code: 403,
});
S3Error.EntityTooSmall = Object.freeze({
    code: 'EntityTooSmall',
    message: 'Your proposed upload is smaller than the minimum allowed object size.',
    http_code: 400,
});
S3Error.EntityTooLarge = Object.freeze({
    code: 'EntityTooLarge',
    message: 'Your proposed upload exceeds the maximum allowed object size.',
    http_code: 400,
});
S3Error.ExpiredToken = Object.freeze({
    code: 'ExpiredToken',
    message: 'The provided token has expired.',
    http_code: 400,
});
S3Error.IllegalVersioningConfigurationException = Object.freeze({
    code: 'IllegalVersioningConfigurationException',
    message: 'Indicates that the versioning configuration specified in the request is invalid.',
    http_code: 400,
});
S3Error.IncompleteBody = Object.freeze({
    code: 'IncompleteBody',
    message: 'You did not provide the number of bytes specified by the Content-Length HTTP header',
    http_code: 400,
});
S3Error.IncorrectNumberOfFilesInPostRequest = Object.freeze({
    code: 'IncorrectNumberOfFilesInPostRequest',
    message: 'POST requires exactly one file upload per request.',
    http_code: 400,
});
S3Error.InlineDataTooLarge = Object.freeze({
    code: 'InlineDataTooLarge',
    message: 'Inline data exceeds the maximum allowed size.',
    http_code: 400,
});
S3Error.InternalError = Object.freeze({
    code: 'InternalError',
    message: 'We encountered an internal error. Please try again.',
    http_code: 500,
});
S3Error.InvalidAccessKeyId = Object.freeze({
    code: 'InvalidAccessKeyId',
    message: 'The AWS access key Id you provided does not exist in our records.',
    http_code: 403,
});
S3Error.InvalidAddressingHeader = Object.freeze({
    code: 'InvalidAddressingHeader',
    message: 'You must specify the Anonymous role.',
    http_code: 400, // N/A,
});
S3Error.InvalidArgument = Object.freeze({
    code: 'InvalidArgument',
    message: 'Invalid Argument',
    http_code: 400,
});
S3Error.InvalidArgumentEmptyVersionId = Object.freeze({
    code: 'InvalidArgument',
    message: 'Version id cannot be the empty string',
    http_code: 400,
});
S3Error.InvalidArgumentEmptyVersionIdMarker = Object.freeze({
    code: 'InvalidArgument',
    message: 'A version-id marker cannot be empty',
    http_code: 400,
});
S3Error.InvalidBucketName = Object.freeze({
    code: 'InvalidBucketName',
    message: 'The specified bucket is not valid.',
    http_code: 400,
});
S3Error.InvalidBucketState = Object.freeze({
    code: 'InvalidBucketState',
    message: 'The request is not valid with the current state of the bucket.',
    http_code: 409,
});
S3Error.ObjectQuotaExceeded = Object.freeze({
    code: 'ObjectQuotaExceeded',
    message: 'Object quota exceeded for the bucket.',
    http_code: 409,
});
S3Error.InvalidDigest = Object.freeze({
    code: 'InvalidDigest',
    message: 'The Content-MD5 you specified is not valid.',
    http_code: 400,
});
S3Error.InvalidEncryptionAlgorithmError = Object.freeze({
    code: 'InvalidEncryptionAlgorithmError',
    message: 'The encryption request you specified is not valid. The valid value is AES256.',
    http_code: 400,
});
S3Error.ServerSideEncryptionConfigurationNotFoundError = Object.freeze({
    code: 'ServerSideEncryptionConfigurationNotFoundError',
    message: 'The server side encryption configuration was not found.',
    http_code: 404,
});
S3Error.InvalidLocationConstraint = Object.freeze({
    code: 'InvalidLocationConstraint',
    message: 'The specified location constraint is not valid. For more information about regions, see How to Select a Region for Your Buckets.',
    http_code: 400,
});
S3Error.InvalidObjectState = Object.freeze({
    code: 'InvalidObjectState',
    message: 'The operation is not valid for the current state of the object.',
    http_code: 403,
});
S3Error.InvalidPart = Object.freeze({
    code: 'InvalidPart',
    message: 'One or more of the specified parts could not be found. The part might not have been uploaded, or the specified entity tag might not have matched the part\'s entity tag.',
    http_code: 400,
});
S3Error.InvalidPartOrder = Object.freeze({
    code: 'InvalidPartOrder',
    message: 'The list of parts was not in ascending order.Parts list must specified in order by part number.',
    http_code: 400,
});
S3Error.InvalidPayer = Object.freeze({
    code: 'InvalidPayer',
    message: 'All access to this object has been disabled.',
    http_code: 403,
});
S3Error.InvalidPolicyDocument = Object.freeze({
    code: 'InvalidPolicyDocument',
    message: 'The content of the form does not meet the conditions specified in the policy document.',
    http_code: 400,
});
S3Error.InvalidRange = Object.freeze({
    code: 'InvalidRange',
    message: 'The requested range cannot be satisfied.',
    http_code: 416,
});
S3Error.InvalidRequest = Object.freeze({
    code: 'InvalidRequest',
    message: 'SOAP requests must be made over an HTTPS connection.',
    http_code: 400,
});
S3Error.InvalidSecurity = Object.freeze({
    code: 'InvalidSecurity',
    message: 'The provided security credentials are not valid.',
    http_code: 403,
});
S3Error.InvalidSOAPRequest = Object.freeze({
    code: 'InvalidSOAPRequest',
    message: 'The SOAP request body is invalid.',
    http_code: 400,
});
S3Error.InvalidStorageClass = Object.freeze({
    code: 'InvalidStorageClass',
    message: 'The storage class you specified is not valid.',
    http_code: 400,
});
S3Error.InvalidTargetBucketForLogging = Object.freeze({
    code: 'InvalidTargetBucketForLogging',
    message: 'The target bucket for logging does not exist, is not owned by you, or does not have the appropriate grants for the log-delivery group.',
    http_code: 400,
});
S3Error.InvalidToken = Object.freeze({
    code: 'InvalidToken',
    message: 'The provided token is malformed or otherwise invalid.',
    http_code: 400,
});
S3Error.InvalidURI = Object.freeze({
    code: 'InvalidURI',
    message: 'Couldn\'t parse the specified URI.',
    http_code: 400,
});
S3Error.KeyTooLongError = Object.freeze({
    code: 'KeyTooLongError',
    message: 'Your key is too long.',
    http_code: 400,
});
S3Error.MalformedACLError = Object.freeze({
    code: 'MalformedACLError',
    message: 'The XML you provided was not well-formed or did not validate against our published schema.',
    http_code: 400,
});
S3Error.MalformedPOSTRequest = Object.freeze({
    code: 'MalformedPOSTRequest',
    message: 'The body of your POST request is not well-formed multipart/form-data.',
    http_code: 400,
});
S3Error.MalformedXML = Object.freeze({
    code: 'MalformedXML',
    // This happens when the user sends malformed xml (xml that doesn't conform to the published xsd) for the configuration.
    message: 'The XML you provided was not well-formed or did not validate against our published schema.',
    http_code: 400,
});
S3Error.InvalidTag = Object.freeze({
    code: 'InvalidTag',
    message: 'The tag provided was not a valid tag.',
    http_code: 400,
});
S3Error.MaxMessageLengthExceeded = Object.freeze({
    code: 'MaxMessageLengthExceeded',
    message: 'Your request was too big.',
    http_code: 400,
});
S3Error.MaxPostPreDataLengthExceededError = Object.freeze({
    code: 'MaxPostPreDataLengthExceededError',
    message: 'Your POST request fields preceding the upload file were too large.',
    http_code: 400,
});
S3Error.MetadataTooLarge = Object.freeze({
    code: 'MetadataTooLarge',
    message: 'Your metadata headers exceed the maximum allowed metadata size.',
    http_code: 400,
});
S3Error.MethodNotAllowed = Object.freeze({
    code: 'MethodNotAllowed',
    message: 'The specified method is not allowed against this resource.',
    http_code: 405,
});
S3Error.MissingAttachment = Object.freeze({
    code: 'MissingAttachment',
    message: 'A SOAP attachment was expected, but none were found.',
    http_code: 400, // N/A,
});
S3Error.MissingContentLength = Object.freeze({
    code: 'MissingContentLength',
    message: 'You must provide the Content-Length HTTP header.',
    http_code: 411,
});
S3Error.MissingRequestBodyError = Object.freeze({
    code: 'MissingRequestBodyError',
    message: 'Request body is empty.',
    http_code: 400,
});
S3Error.MissingSecurityElement = Object.freeze({
    code: 'MissingSecurityElement',
    message: 'The SOAP 1.1 request is missing a security element.',
    http_code: 400,
});
S3Error.MissingSecurityHeader = Object.freeze({
    code: 'MissingSecurityHeader',
    message: 'Your request is missing a required header.',
    http_code: 400,
});
S3Error.NoLoggingStatusForKey = Object.freeze({
    code: 'NoLoggingStatusForKey',
    message: 'There is no such thing as a logging status subresource for a key.',
    http_code: 400,
});
S3Error.NoSuchBucket = Object.freeze({
    code: 'NoSuchBucket',
    message: 'The specified bucket does not exist',
    http_code: 404,
});
S3Error.NoSuchKey = Object.freeze({
    code: 'NoSuchKey',
    message: 'The specified key does not exist.',
    http_code: 404,
});
S3Error.NoSuchLifecycleConfiguration = Object.freeze({
    code: 'NoSuchLifecycleConfiguration',
    message: 'The lifecycle configuration does not exist.',
    http_code: 404,
});
S3Error.NoSuchCORSConfiguration = Object.freeze({
    code: 'NoSuchCORSConfiguration',
    message: 'The specified bucket does not have a CORS configuration.',
    http_code: 404,
});
S3Error.NoSuchUpload = Object.freeze({
    code: 'NoSuchUpload',
    message: 'The specified multipart upload does not exist. The upload ID might be invalid, or the multipart upload might have been aborted or completed.',
    http_code: 404,
});
S3Error.NoSuchVersion = Object.freeze({
    code: 'NoSuchVersion',
    message: 'Indicates that the version ID specified in the request does not match an existing version.',
    http_code: 404,
});
S3Error.NotImplemented = Object.freeze({
    code: 'NotImplemented',
    message: 'A header you provided implies functionality that is not implemented.',
    http_code: 501,
});
S3Error.NotSignedUp = Object.freeze({
    code: 'NotSignedUp',
    message: 'Your account is not signed up for the Amazon S3 service. You must sign up before you can use, Amazon S3. You can sign up at the following URL: http://aws.amazon.com/s3',
    http_code: 403,
});
S3Error.NoSuchBucketPolicy = Object.freeze({
    code: 'NoSuchBucketPolicy',
    message: 'The specified bucket does not have a bucket policy.',
    http_code: 404,
});
S3Error.OperationAborted = Object.freeze({
    code: 'OperationAborted',
    message: 'A conflicting conditional operation is currently in progress against this resource. Try again.',
    http_code: 409,
});
S3Error.PermanentRedirect = Object.freeze({
    code: 'PermanentRedirect',
    message: 'The bucket you are attempting to access must be addressed using the specified endpoint. Send all future requests to this endpoint.',
    http_code: 301,
});
S3Error.PreconditionFailed = Object.freeze({
    code: 'PreconditionFailed',
    message: 'At least one of the preconditions you specified did not hold.',
    http_code: 412,
});
S3Error.Redirect = Object.freeze({
    code: 'Redirect',
    message: 'Temporary redirect.',
    http_code: 307,
});
S3Error.RestoreAlreadyInProgress = Object.freeze({
    code: 'RestoreAlreadyInProgress',
    message: 'Object restore is already in progress.',
    http_code: 409,
});
S3Error.RequestIsNotMultiPartContent = Object.freeze({
    code: 'RequestIsNotMultiPartContent',
    message: 'Bucket POST must be of the enclosure-type multipart/form-data.',
    http_code: 400,
});
S3Error.RequestTimeout = Object.freeze({
    code: 'RequestTimeout',
    message: 'Your socket connection to the server was not read from or written to within the timeout period.',
    http_code: 400,
});
S3Error.RequestTimeTooSkewed = Object.freeze({
    code: 'RequestTimeTooSkewed',
    message: 'The difference between the request time and the server\'s time is too large.',
    http_code: 403,
});
S3Error.RequestTorrentOfBucketError = Object.freeze({
    code: 'RequestTorrentOfBucketError',
    message: 'Requesting the torrent file of a bucket is not permitted.',
    http_code: 400,
});
S3Error.SignatureDoesNotMatch = Object.freeze({
    code: 'SignatureDoesNotMatch',
    message: 'The request signature we calculated does not match the signature you provided. Check your AWS secret access key and signing method. For more information, see REST Authentication and SOAP Authentication for details.',
    http_code: 403,
});
S3Error.ServiceUnavailable = Object.freeze({
    code: 'ServiceUnavailable',
    message: 'Reduce your request rate.',
    http_code: 503,
});
S3Error.SlowDown = Object.freeze({
    code: 'SlowDown',
    message: 'Reduce your request rate.',
    http_code: 503,
});
S3Error.TemporaryRedirect = Object.freeze({
    code: 'TemporaryRedirect',
    message: 'You are being redirected to the bucket while DNS updates.',
    http_code: 307,
});
S3Error.TokenRefreshRequired = Object.freeze({
    code: 'TokenRefreshRequired',
    message: 'The provided token must be refreshed.',
    http_code: 400,
});
S3Error.TooManyBuckets = Object.freeze({
    code: 'TooManyBuckets',
    message: 'You have attempted to create more buckets than allowed.',
    http_code: 400,
});
S3Error.UnexpectedContent = Object.freeze({
    code: 'UnexpectedContent',
    message: 'This request does not support content.',
    http_code: 400,
});
S3Error.UnresolvableGrantByEmailAddress = Object.freeze({
    code: 'UnresolvableGrantByEmailAddress',
    message: 'The email address you provided does not match any account on record.',
    http_code: 400,
});
S3Error.UserKeyMustBeSpecified = Object.freeze({
    code: 'UserKeyMustBeSpecified',
    message: 'The bucket POST must contain the specified field name. If it is specified, check the order of the fields.',
    http_code: 400,
});
S3Error.NoSuchTagSet = Object.freeze({
    code: 'NoSuchTagSet',
    message: 'The tag provided is not found.',
    http_code: 404,
});
S3Error.AccessControlListNotSupported = Object.freeze({
    code: 'AccessControlListNotSupported',
    message: 'The bucket does not allow ACLs.',
    http_code: 400,
});

/////////////////////////////////////
// Errors for generic HTTP replies //
/////////////////////////////////////
S3Error.NotModified = Object.freeze({
    code: 'NotModified',
    // this short undescriptive message is compatible with AWS and is expected by s3-tests
    message: 'Not Modified',
    http_code: 304,
});
S3Error.BadRequest = Object.freeze({
    code: 'BadRequest',
    message: 'Bad Request',
    http_code: 400,
});
S3Error.BadRequestWithoutCode = Object.freeze({
    // same as BadRequest but without encoding the <Code> field
    // was needed for one of the cases in ceph/s3tests
    message: 'Bad Request',
    http_code: 400,
});

////////////////////////////////////////////////////////////////
// Errors actually returned by AWS S3 although not documented //
////////////////////////////////////////////////////////////////
S3Error.ReplicationConfigurationNotFoundError = Object.freeze({
    code: 'ReplicationConfigurationNotFoundError',
    message: 'The replication configuration was not found',
    http_code: 404,
});
S3Error.NoSuchWebsiteConfiguration = Object.freeze({
    code: 'NoSuchWebsiteConfiguration',
    message: 'The specified bucket does not have a website configuration',
    http_code: 404,
});
S3Error.XAmzContentSHA256Mismatch = Object.freeze({
    code: 'XAmzContentSHA256Mismatch',
    message: 'The provided \'x-amz-content-sha256\' header does not match what was computed.',
    http_code: 400,
    // ClientComputedContentSHA256: '...',
    // S3ComputedContentSHA256: '...',
});
S3Error.MalformedPolicy = Object.freeze({
    code: 'MalformedPolicy',
    message: 'Invalid principal in policy',
    http_code: 400,
    detail: '...', // will be overridden from rpc_data, see handle_error in s3_rest.js
});

S3Error.MalformedPolicyNotAJSON = Object.freeze({
    code: 'MalformedPolicy',
    message: 'The specified policy syntax is not valid.',
    http_code: 400,
    detail: '...', // will be overridden from rpc_data, see handle_error in s3_rest.js
});

S3Error.NoSuchObjectLockConfiguration = Object.freeze({
    code: 'NoSuchObjectLockConfiguration',
    message: 'The specified object does not have a ObjectLock configuration',
    http_code: 404,
});
S3Error.ObjectLockConfigurationNotFoundError = Object.freeze({
    code: 'ObjectLockConfigurationNotFoundError',
    message: 'Object Lock configuration does not exist for this bucket',
    http_code: 404,
});
S3Error.InvalidEncodingType = Object.freeze({
    code: 'InvalidArgument',
    message: 'Invalid Encoding Method specified in Request',
    http_code: 400,
});
S3Error.AuthorizationQueryParametersErrorWeek = Object.freeze({
    code: 'AuthorizationQueryParametersError',
    message: 'X-Amz-Expires must be less than a week (in seconds); that is, the given X-Amz-Expires must be less than 604800 seconds',
    http_code: 400,
});
S3Error.AuthorizationQueryParametersErrorNonNegative = Object.freeze({
    code: 'AuthorizationQueryParametersError',
    message: 'X-Amz-Expires must be non-negative',
    http_code: 400,
});
S3Error.RequestExpired = Object.freeze({
    code: 'AccessDenied',
    message: 'Request has expired',
    http_code: 403,
});
S3Error.RequestNotValidYet = Object.freeze({
    code: 'AccessDenied',
    message: 'request is not valid yet',
    http_code: 403,
});

////////////////////////////////////////////////////////////////
// S3 Select                                                  //
////////////////////////////////////////////////////////////////

S3Error.S3SelectNotCompiled = Object.freeze({
    code: 'S3SelectNotCompiled',
    message: 'This server was not compiled with S3 Select support. Recompile with BUILD_S3SELECT=1.',
    http_code: 501,
});
S3Error.S3SelectParquetNotCompiled = Object.freeze({
    code: 'S3SelectParquetNotCompiled',
    message: 'This server was not compiled with S3 Select for Parquet. Recompile with BUILD_S3SELECT=1 and BUILD_S3SELECT_PARQUET=1.',
    http_code: 501,
});
S3Error.MissingInputSerialization = Object.freeze({
    code: 'MissingRequiredParameter',
    message: 'InputSerialization is required. Please check the service documentation and try again.',
    http_code: 400,
});
S3Error.OutputInputFormatMismatch = Object.freeze({
    code: 'OutputInputFormatMismatch',
    message: 'OutputSerialization format must match InputSerializatoin format.',
    http_code: 501,
});

////////////////////////////////////////////////////////////////
// S3 Restore Object
////////////////////////////////////////////////////////////////

S3Error.InvalidObjectStorageClass = Object.freeze({
    code: 'InvalidObjectState',
    message: 'Restore is not allowed for the object\'s current storage class.',
    http_code: 403,
});

////////////////////////////////////////////////////////////////
// S3 RDMA
////////////////////////////////////////////////////////////////

S3Error.S3InvalidRdmaToken = Object.freeze({
    code: 'S3InvalidRdmaToken',
    message: 'The specified S3-RDMA token is not valid.',
    http_code: 400,
});

S3Error.S3RdmaNotSupported = Object.freeze({
    code: 'S3RdmaNotSupported',
    message: 'S3-RDMA is not supported.',
    http_code: 501,
});

S3Error.S3RdmaIoError = Object.freeze({
    code: 'S3RdmaIoError',
    message: 'S3-RDMA I/O error occurred.',
    http_code: 500,
});


S3Error.RPC_ERRORS_TO_S3 = Object.freeze({
    UNAUTHORIZED: S3Error.AccessDenied,
    BAD_REQUEST: S3Error.BadRequest,
    FORBIDDEN: S3Error.AccessDenied,
    NO_SUCH_BUCKET: S3Error.NoSuchBucket,
    NO_SUCH_OBJECT: S3Error.NoSuchKey,
    INVALID_BUCKET_NAME: S3Error.InvalidBucketName,
    NOT_EMPTY: S3Error.BucketNotEmpty,
    BUCKET_ALREADY_EXISTS: S3Error.BucketAlreadyExists,
    BUCKET_ALREADY_OWNED_BY_YOU: S3Error.BucketAlreadyOwnedByYou,
    NO_SUCH_UPLOAD: S3Error.NoSuchUpload,
    BAD_DIGEST_MD5: S3Error.BadDigest,
    BAD_DIGEST_SHA256: S3Error.XAmzContentSHA256Mismatch,
    BAD_SIZE: S3Error.IncompleteBody,
    IF_MODIFIED_SINCE: S3Error.NotModified,
    IF_UNMODIFIED_SINCE: S3Error.PreconditionFailed,
    IF_MATCH_ETAG: S3Error.PreconditionFailed,
    IF_NONE_MATCH_ETAG: S3Error.NotModified,
    IO_STREAM_ITEM_TIMEOUT: S3Error.SlowDown,
    INVALID_PART: S3Error.InvalidPart,
    INVALID_PORT_ORDER: S3Error.InvalidPartOrder,
    INVALID_BUCKET_STATE: S3Error.InvalidBucketState,
    NOT_ENOUGH_SPACE: S3Error.InvalidBucketState,
    OBJECT_QUOTA_EXCEEDED: S3Error.ObjectQuotaExceeded,
    MALFORMED_POLICY: S3Error.MalformedPolicy,
    NO_SUCH_OBJECT_LOCK_CONFIGURATION: S3Error.NoSuchObjectLockConfiguration,
    OBJECT_LOCK_CONFIGURATION_NOT_FOUND_ERROR: S3Error.ObjectLockConfigurationNotFoundError,
    INVALID_REQUEST: S3Error.InvalidRequest,
    NOT_IMPLEMENTED: S3Error.NotImplemented,
    INVALID_ACCESS_KEY_ID: S3Error.InvalidAccessKeyId,
    DEACTIVATED_ACCESS_KEY_ID: S3Error.InvalidAccessKeyId,
    SIGNATURE_DOES_NOT_MATCH: S3Error.SignatureDoesNotMatch,
    SERVICE_UNAVAILABLE: S3Error.ServiceUnavailable,
    INVALID_RANGE: S3Error.InvalidRange,
    INVALID_OBJECT_STATE: S3Error.InvalidObjectState,
    INTERNAL_ERROR: S3Error.InternalError,
    SERVER_SIDE_ENCRYPTION_CONFIGURATION_NOT_FOUND_ERROR: S3Error.ServerSideEncryptionConfigurationNotFoundError,
    NO_SUCH_TAG: S3Error.NoSuchTagSet,
    INVALID_ENCODING_TYPE: S3Error.InvalidEncodingType,
    INVALID_TARGET_BUCKET: S3Error.InvalidTargetBucketForLogging,
    METHOD_NOT_ALLOWED: S3Error.MethodNotAllowed,
});

exports.S3Error = S3Error;
