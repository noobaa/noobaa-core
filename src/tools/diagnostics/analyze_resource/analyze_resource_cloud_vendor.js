/* Copyright (C) 2023 NooBaa */
'use strict';

const fs = require('fs');
const SensitiveString = require('../../../util/sensitive_string');
const AnalyzeAws = require('./analyze_resource_aws');
const AnalyzeGcp = require('./analyze_resource_gcp');
const AnalyzeAzure = require('./analyze_resource_azure');

const secret_path = '/etc/cloud-credentials';

function get_cloud_vendor(resource_type, connection_basic_details) {
    let cloud_vendor;
    const credentials = get_credentials(resource_type);

    switch (resource_type) {
        case 'aws-s3':
            cloud_vendor = new AnalyzeAws(credentials.access_key, credentials.secret_access_key,
                connection_basic_details.endpoint, connection_basic_details.signature_version,
                connection_basic_details.region);
            break;
        case 's3-compatible':
            cloud_vendor = new AnalyzeAws(credentials.access_key, credentials.secret_access_key,
                connection_basic_details.endpoint, connection_basic_details.signature_version);
            break;
        case 'ibm-cos':
            cloud_vendor = new AnalyzeAws(credentials.access_key, credentials.secret_access_key,
                connection_basic_details.endpoint, connection_basic_details.signature_version);
            break;
        case 'azure-blob':
            cloud_vendor = new AnalyzeAzure(credentials.access_key, credentials.secret_access_key, // Azure storage account name is stored as the access key
                connection_basic_details.endpoint);
            break;
        case 'google-cloud-storage':
            cloud_vendor = new AnalyzeGcp(credentials.private_key_json);
            break;
        default:
            throw new Error(`Could not create cloud vendor client of ${resource_type}`);
    }
    return cloud_vendor;
}

function get_credentials(resource_type) {
    const credentials_properties = get_credentials_properties(resource_type);
    if (credentials_properties.length === 2) { // assuming that we have up to 2 fields ("google-cloud-storage" is a special case)
        const access_key_path = `${secret_path}/${credentials_properties[0]}`;
        const access_key = new SensitiveString(fs.readFileSync(access_key_path).toString().trim());
        const secret_access_key_path = `${secret_path}/${credentials_properties[1]}`;
        const secret_access_key = new SensitiveString(fs.readFileSync(secret_access_key_path).toString().trim());
        return { access_key, secret_access_key };
    } else if (credentials_properties.length === 1) { // "google-cloud-storage" case
        const private_key_json = `${secret_path}/${get_credentials_properties(resource_type)}`;
        return { private_key_json };
    } else {
        throw new Error(`Could not get credentials from ${resource_type}`);
    }
}

function get_credentials_properties(resource_type) {
    const map_store_type_secret_properties = {
        'aws-s3': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'], // backingstores and namespacestores
        's3-compatible': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'], // backingstores and namespacestores
        'ibm-cos': ['IBM_COS_ACCESS_KEY_ID', 'IBM_COS_SECRET_ACCESS_KEY'], // backingstores and namespacestores
        'azure-blob': ['AccountName', 'AccountKey'], // backingstores and namespacestores
        'google-cloud-storage': ['GoogleServiceAccountPrivateKeyJson'], // backingstores and namespacestores
        // "pv-pool": [], // backingstores
        // "nsfs": [], // namespacestores
    };
    return map_store_type_secret_properties[resource_type];
}

// EXPORTS
exports.get_cloud_vendor = get_cloud_vendor;
