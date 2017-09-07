import { deepFreeze } from 'utils/core-utils';
import { strictify } from 'utils/schema-utils';
import * as common from './common';
import location from './location';
import session from './session';
import objectUploads from './object-uploads';
import internalResources from './internal-resources';
import buckets from './buckets';
import state from './state.js';

const schemas = {
    common,
    location,
    session,
    objectUploads,
    internalResources,
    buckets,
    state
};

// Stricitfy the schema definitions.
Object.values(schemas)
    .forEach(strictify);


export default deepFreeze({
    def: schemas,

    // Define that root schema for the validator will be the state schema.
    $ref: '#/def/state',
});

