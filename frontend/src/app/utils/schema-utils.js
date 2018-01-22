/* Copyright (C) 2016 NooBaa */

import Ajv from 'ajv';
import { isObject } from 'utils/core-utils';
import { escapeQuotes } from 'utils/string-utils';

export function createSchemaValidator(schema) {
    // Strictify the schema definitions.
    const ajv = new Ajv();
    const avjValidate = ajv.compile(schema);

    return function validate(state) {
        if (!avjValidate(state)) {
            return avjValidate.errors
                .map(error => {
                    if (error.dataPath) {
                        const accessor = _createDataPathAccessor(error.dataPath);
                        error.data = accessor(state);
                    }
                    return error;
                });
        }
    };
}

export function strictify(schema) {
    if (isObject(schema)) {
        if (schema.type === 'object') {
            schema.additionalProperties = schema.additionalProperties || false;
        }

        Object.values(schema).forEach(strictify);
    }

    return schema;
}

function _createDataPathAccessor(dataPath) {
    const body = `
        try {
            return state${dataPath};
        } catch (err) {
            console.warn('SCHEMA DATA ACCSSESOR, Could not retrive data for path: ${
                escapeQuotes(dataPath)
            }');
            return;
        }
    `;

    try {
        return new Function('state', body);
    } catch (err) {
        return function() {
            console.warn(`SCHEMA DATA ACCSSESOR, Could not compile data accessor for path: ${dataPath}`);
            return;
        };
    }
}
