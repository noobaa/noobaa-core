/* Copyright (C) 2017 NooBaa */

import { externalDataSchema } from '../schema';
import { createSchemaValidator } from '../utils/schema-utils';
//import { deepFreeze } from 'utils/core-utils';

const itemsSym = Symbol();

// Check state against schema
function _validateJson(json, name) {
    const schemaValidator = createSchemaValidator(externalDataSchema[name]);
    const errors = schemaValidator(json);
    if (errors) {
        console.error('INVALID JSON', { json, errors });
        throw new Error('Invalid json');
    }
}

class ExternalDataStore {
    constructor(uris) {
        this[itemsSym] = new Map(uris);
    }

    async fetch(name) {
        const item = this[itemsSym].get(name);
        if(!item || item.value) return false;

        try {
            const response = await fetch(item.uri);
            const contentType = response.headers.get('content-type');
            if(contentType && contentType.includes('application/json')) {
                const json = await response.json();
                _validateJson(json, name);
                this[itemsSym].set(name, { ...item, value: json });
                return true;
            }
        } catch(error) {
            console.warn('fetch.error', error);
            throw error;
        }
    }

    get(name) {
        const item = this[itemsSym].get(name);

        return item && item.value;
    }
}

export default new ExternalDataStore([
    ['helpMetadata', { uri: `${window.location.origin}/fe/assets/interactive-help.json` }]
]);
