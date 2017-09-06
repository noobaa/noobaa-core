import Ajv from 'ajv';

export function createSchemaValidator(schema) {
    _strictify(schema);

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

function _strictify(schema) {
    if (schema && schema.type === 'object') {
        schema.additionalProperties = schema.additionalProperties || false;
        Object.values(schema.properties || {}).forEach(_strictify);
    }
}

function _createDataPathAccessor(dataPath) {
    const body = `
        try {
            return state${dataPath};
        } catch (err) {
            console.warn('SCHEMA DATA ACCSSESOR, Could not retrive data for path: ${dataPath}');
            return;
        }
    `;

    try {
        return new Function('state', body);
    } catch(err) {
        return function() {
            console.warn(`SCHEMA DATA ACCSSESOR, Could not retrive data for path: ${dataPath}`);
            return;
        };
    }
}
