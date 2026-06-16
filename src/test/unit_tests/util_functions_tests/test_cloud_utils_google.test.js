/* Copyright (C) 2026 NooBaa */
'use strict';

jest.mock('../../../util/google_storage_wrap');

/*
GoogleStorage is a Jest mock of the real Storage constructor (via jest.mock('../../../util/google_storage_wrap')).
Every time the code runs new GoogleStorage(options), Jest records that call. mock.calls is the list of those calls:
  - mock.calls[0] — first call (first new GoogleStorage(...))
  - mock.calls[0][0] — first argument to that call (the options object: { credentials, projectId })
*/

const GoogleStorage = jest.mocked(require('../../../util/google_storage_wrap'));
const cloud_utils = require('../../../util/cloud_utils');

const ENDPOINT_TYPE_GOOGLE = 'GOOGLE';
const ENDPOINT_TYPE_GOOGLE_STS = 'GOOGLE_STS';
const ENDPOINT_TYPE_AWS = 'AWS';

const CREDENTIAL_TYPE_SERVICE_ACCOUNT = 'service_account';
const CREDENTIAL_TYPE_EXTERNAL_ACCOUNT = 'external_account';

const PROJECT_ID = 'my-project';
const CLIENT_EMAIL = 'sa@my-project.iam.gserviceaccount.com';
const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n';
const PRIVATE_KEY_ID = 'key-id';
const INVALID_JSON = 'not-json';
const TEST_SA_EMAIL = 'sa@test.iam.gserviceaccount.com';
const TEST_AUDIENCE = 'aud';

const WIF_AUDIENCE = '//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/pool/providers/provider';
const WIF_SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
const WIF_TOKEN_URL = 'https://sts.googleapis.com/v1/token';
const WIF_CREDENTIAL_SOURCE_FILE = '/var/run/secrets/openshift/serviceaccount/token';
const WIF_CREDENTIAL_SOURCE_FORMAT = 'text';
const WIF_SERVICE_ACCOUNT_IMPERSONATION_URL =
    'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sa@project.iam.gserviceaccount.com:generateAccessToken';
const EXAMPLE_TOKEN_URL = 'https://example.com/token';
const EXECUTABLE_CMD = '/path/to/cmd';
const ENVIRONMENT_ID_AWS1 = 'aws1';

const INVALID_GOOGLE_ENDPOINT_TYPE_ERROR = /Invalid Google endpoint type: AWS/;

// Sample GCP key-file shapes used as test inputs (not real credentials).
const SERVICE_ACCOUNT_JSON_FIXTURE = {
    type: CREDENTIAL_TYPE_SERVICE_ACCOUNT,
    project_id: PROJECT_ID,
    client_email: CLIENT_EMAIL,
    private_key: PRIVATE_KEY,
    private_key_id: PRIVATE_KEY_ID,
};

const EXTERNAL_ACCOUNT_JSON_FIXTURE = {
    type: CREDENTIAL_TYPE_EXTERNAL_ACCOUNT,
    audience: WIF_AUDIENCE,
    subject_token_type: WIF_SUBJECT_TOKEN_TYPE,
    token_url: WIF_TOKEN_URL,
    credential_source: {
        file: WIF_CREDENTIAL_SOURCE_FILE,
        format: WIF_CREDENTIAL_SOURCE_FORMAT,
    },
    service_account_impersonation_url: WIF_SERVICE_ACCOUNT_IMPERSONATION_URL,
};

describe('parse_google_secret_json', () => {
    it('parses a valid JSON string', () => {
        const parsed = cloud_utils.parse_google_secret_json(JSON.stringify(SERVICE_ACCOUNT_JSON_FIXTURE));
        expect(parsed).toEqual(SERVICE_ACCOUNT_JSON_FIXTURE);
    });

    it('returns the same object when input is already parsed', () => {
        const parsed = cloud_utils.parse_google_secret_json(SERVICE_ACCOUNT_JSON_FIXTURE);
        expect(parsed).toBe(SERVICE_ACCOUNT_JSON_FIXTURE);
    });

    it('throws on invalid JSON string', () => {
        expect(() => cloud_utils.parse_google_secret_json(INVALID_JSON)).toThrow(SyntaxError);
    });
});

describe('build_google_cloud_info', () => {
    it('extracts service account fields for GOOGLE', () => {
        expect(cloud_utils.build_google_cloud_info(
            ENDPOINT_TYPE_GOOGLE,
            JSON.stringify(SERVICE_ACCOUNT_JSON_FIXTURE)
        )).toEqual({
            project_id: PROJECT_ID,
            client_email: CLIENT_EMAIL,
            private_key: PRIVATE_KEY,
        });
    });

    it('keeps full credentials_json for GOOGLE_STS', () => {
        expect(cloud_utils.build_google_cloud_info(
            ENDPOINT_TYPE_GOOGLE_STS,
            JSON.stringify(EXTERNAL_ACCOUNT_JSON_FIXTURE)
        )).toEqual({
            credentials_json: EXTERNAL_ACCOUNT_JSON_FIXTURE,
        });
    });

    it('rejects unsupported endpoint types', () => {
        expect(() => cloud_utils.build_google_cloud_info(
            ENDPOINT_TYPE_AWS,
            JSON.stringify(SERVICE_ACCOUNT_JSON_FIXTURE)
        )).toThrow(INVALID_GOOGLE_ENDPOINT_TYPE_ERROR);
    });
});

describe('_is_valid_google_wif_credential_source (via create_google_storage_from_connection)', () => {
    const CREDENTIAL_SOURCE_ERROR = /expected file path for projected token/;

    beforeEach(() => {
        GoogleStorage.mockImplementation(() => /** @type {import('../../../util/google_storage_wrap')} */ (
            /** @type {unknown} */ ({ mockClient: true })
        ));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('accepts credential_source with file path', () => {
        cloud_utils.create_google_storage_from_connection(EXTERNAL_ACCOUNT_JSON_FIXTURE);
        expect(GoogleStorage).toHaveBeenCalledTimes(1);
    });

    it('accepts file path without optional format', () => {
        cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: {
                file: WIF_CREDENTIAL_SOURCE_FILE,
                // format: 'text' is missing -> is valid because it's optional and can be omitted.
            },
        });
        expect(GoogleStorage).toHaveBeenCalledTimes(1);
    });

    it('rejects null credential_source', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: null,
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects missing credential_source', () => {
        const { credential_source, ...credentials_without_source } = EXTERNAL_ACCOUNT_JSON_FIXTURE;
        expect(credential_source).toBeDefined();

        expect(() => cloud_utils.create_google_storage_from_connection(credentials_without_source))
            .toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects non-object credential_source', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: '',
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: [],
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects empty credential_source object', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: {},
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects credential_source when file is missing or empty', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: { format: WIF_CREDENTIAL_SOURCE_FORMAT },
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: { file: '' },
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects other GCP credential_source types without file', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: { url: EXAMPLE_TOKEN_URL },
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: { executable: { command: EXECUTABLE_CMD } },
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: { environment_id: ENVIRONMENT_ID_AWS1 },
        })).toThrow(CREDENTIAL_SOURCE_ERROR);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });
});

describe('is_google_wif_credentials', () => {
    it('returns true for external_account credentials', () => {
        expect(cloud_utils.is_google_wif_credentials(EXTERNAL_ACCOUNT_JSON_FIXTURE)).toBe(true);
    });

    it('returns false for service_account credentials', () => {
        expect(cloud_utils.is_google_wif_credentials(SERVICE_ACCOUNT_JSON_FIXTURE)).toBe(false);
    });

    it('returns false for null, undefined, and empty object', () => {
        expect(cloud_utils.is_google_wif_credentials(null)).toBe(false);
        expect(cloud_utils.is_google_wif_credentials(undefined)).toBe(false);
        expect(cloud_utils.is_google_wif_credentials({})).toBe(false);
    });
});

describe('create_google_storage_from_connection', () => {
    beforeEach(() => {
        GoogleStorage.mockImplementation(() => /** @type {import('../../../util/google_storage_wrap')} */ (
            /** @type {unknown} */ ({ mockClient: true })
        ));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('creates a Storage client for service_account JSON string', () => {
        cloud_utils.create_google_storage_from_connection(JSON.stringify(SERVICE_ACCOUNT_JSON_FIXTURE));

        expect(GoogleStorage).toHaveBeenCalledTimes(1);
        expect(GoogleStorage).toHaveBeenCalledWith({
            credentials: {
                client_email: SERVICE_ACCOUNT_JSON_FIXTURE.client_email,
                private_key: SERVICE_ACCOUNT_JSON_FIXTURE.private_key,
            },
            projectId: SERVICE_ACCOUNT_JSON_FIXTURE.project_id,
        });
    });

    it('creates a Storage client for service_account parsed object', () => {
        cloud_utils.create_google_storage_from_connection(SERVICE_ACCOUNT_JSON_FIXTURE);

        expect(GoogleStorage).toHaveBeenCalledWith({
            credentials: {
                client_email: SERVICE_ACCOUNT_JSON_FIXTURE.client_email,
                private_key: SERVICE_ACCOUNT_JSON_FIXTURE.private_key,
            },
            projectId: SERVICE_ACCOUNT_JSON_FIXTURE.project_id,
        });
    });

    it('does not pass extra service_account fields into credentials', () => {
        cloud_utils.create_google_storage_from_connection(SERVICE_ACCOUNT_JSON_FIXTURE);

        const call = GoogleStorage.mock.calls[0][0];
        expect(Object.keys(call.credentials).sort()).toEqual(['client_email', 'private_key']);
    });

    it('creates a Storage client for external_account (WIF) JSON string', () => {
        cloud_utils.create_google_storage_from_connection(JSON.stringify(EXTERNAL_ACCOUNT_JSON_FIXTURE));

        expect(GoogleStorage).toHaveBeenCalledWith({
            credentials: EXTERNAL_ACCOUNT_JSON_FIXTURE,
        });
        const call = GoogleStorage.mock.calls[0][0];
        expect(call).not.toHaveProperty('projectId');
    });

    it('creates a Storage client for external_account (WIF) parsed object', () => {
        cloud_utils.create_google_storage_from_connection(EXTERNAL_ACCOUNT_JSON_FIXTURE);

        expect(GoogleStorage).toHaveBeenCalledWith({
            credentials: EXTERNAL_ACCOUNT_JSON_FIXTURE,
        });
    });

    it('returns the Storage client instance', () => {
        const client = /** @type {import('../../../util/google_storage_wrap')} */ (
            /** @type {unknown} */ ({ mockClient: true })
        );
        GoogleStorage.mockReturnValue(client);

        expect(cloud_utils.create_google_storage_from_connection(SERVICE_ACCOUNT_JSON_FIXTURE)).toBe(client);
    });

    it('creates a Storage client for flat service_account connection_params (block store delegation)', () => {
        const flat_params = {
            project_id: SERVICE_ACCOUNT_JSON_FIXTURE.project_id,
            client_email: SERVICE_ACCOUNT_JSON_FIXTURE.client_email,
            private_key: SERVICE_ACCOUNT_JSON_FIXTURE.private_key,
        };
        cloud_utils.create_google_storage_from_connection(flat_params);

        expect(GoogleStorage).toHaveBeenCalledWith({
            credentials: {
                client_email: flat_params.client_email,
                private_key: flat_params.private_key,
            },
            projectId: flat_params.project_id,
        });
    });

    it('rejects incomplete service_account credentials', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            type: CREDENTIAL_TYPE_SERVICE_ACCOUNT,
            client_email: TEST_SA_EMAIL,
        })).toThrow(/missing required fields/);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects credentials without type and without client_email/private_key', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            type: CREDENTIAL_TYPE_SERVICE_ACCOUNT,
            project_id: PROJECT_ID,
        })).toThrow(/missing required fields/);
        expect(() => cloud_utils.create_google_storage_from_connection({
            project_id: PROJECT_ID,
        })).toThrow(/expected type field or client_email\/private_key/);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects incomplete external_account credentials (missing GCP WIF (STS) fields)', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            type: CREDENTIAL_TYPE_EXTERNAL_ACCOUNT,
            audience: TEST_AUDIENCE,
        })).toThrow(/missing required GCP WIF \(STS\) fields/);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects external_account credentials with empty credential_source', () => {
        expect(() => cloud_utils.create_google_storage_from_connection({
            ...EXTERNAL_ACCOUNT_JSON_FIXTURE,
            credential_source: {},
        })).toThrow(/expected file path for projected token/);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects external_account credentials without credential_source', () => {
        const { credential_source, ...without_source } = EXTERNAL_ACCOUNT_JSON_FIXTURE;
        expect(credential_source).toBeDefined();

        expect(() => cloud_utils.create_google_storage_from_connection(without_source))
            .toThrow(/expected file path for projected token/);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects external_account credentials without service_account_impersonation_url', () => {
        const { service_account_impersonation_url, ...without_impersonation } = EXTERNAL_ACCOUNT_JSON_FIXTURE;
        expect(service_account_impersonation_url).toBeDefined();

        expect(() => cloud_utils.create_google_storage_from_connection(without_impersonation))
            .toThrow(/missing service_account_impersonation_url/);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects non-object credentials', () => {
        expect(() => cloud_utils.create_google_storage_from_connection(null))
            .toThrow(/expected object/);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });

    it('rejects array credentials', () => {
        expect(() => cloud_utils.create_google_storage_from_connection([]))
            .toThrow(/expected object/);
        expect(GoogleStorage).not.toHaveBeenCalled();
    });
});

describe('are_same_google_credentials', () => {
    it('returns true for identical JSON strings', () => {
        const json = JSON.stringify(SERVICE_ACCOUNT_JSON_FIXTURE);
        expect(cloud_utils.are_same_google_credentials(json, json)).toBe(true);
    });

    it('returns true for equivalent service_account JSON with different key order', () => {
        const a = JSON.stringify(SERVICE_ACCOUNT_JSON_FIXTURE);
        const b = JSON.stringify({
            private_key: PRIVATE_KEY,
            client_email: CLIENT_EMAIL,
            project_id: PROJECT_ID,
            type: CREDENTIAL_TYPE_SERVICE_ACCOUNT,
            private_key_id: PRIVATE_KEY_ID,
        });
        expect(cloud_utils.are_same_google_credentials(a, b)).toBe(true);
    });

    it('returns false for different service_account private keys', () => {
        const a = JSON.stringify(SERVICE_ACCOUNT_JSON_FIXTURE);
        const b = JSON.stringify({ ...SERVICE_ACCOUNT_JSON_FIXTURE, private_key: 'other-key' });
        expect(cloud_utils.are_same_google_credentials(a, b)).toBe(false);
    });

    it('returns true for equivalent external_account JSON with different formatting', () => {
        const a = JSON.stringify(EXTERNAL_ACCOUNT_JSON_FIXTURE);
        const b = JSON.stringify({
            service_account_impersonation_url: WIF_SERVICE_ACCOUNT_IMPERSONATION_URL,
            token_url: WIF_TOKEN_URL,
            audience: WIF_AUDIENCE,
            type: CREDENTIAL_TYPE_EXTERNAL_ACCOUNT,
            subject_token_type: WIF_SUBJECT_TOKEN_TYPE,
            credential_source: {
                format: WIF_CREDENTIAL_SOURCE_FORMAT,
                file: WIF_CREDENTIAL_SOURCE_FILE,
            },
        });
        expect(cloud_utils.are_same_google_credentials(a, b)).toBe(true);
    });

    it('returns false when mixing service_account and external_account', () => {
        expect(cloud_utils.are_same_google_credentials(
            JSON.stringify(SERVICE_ACCOUNT_JSON_FIXTURE),
            JSON.stringify(EXTERNAL_ACCOUNT_JSON_FIXTURE),
        )).toBe(false);
    });

    it('returns false for invalid JSON', () => {
        expect(cloud_utils.are_same_google_credentials(INVALID_JSON, INVALID_JSON)).toBe(false);
    });
});
