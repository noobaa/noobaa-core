import sessionSchema from './session';
import locationSchema from './location';
import objectUploadsSchema from './object-uploads';

export default {
    type: 'object',
    additionalProperties: true,
    properties: {
        session: sessionSchema,
        location: locationSchema,
        objectUploads: objectUploadsSchema
    }
};
