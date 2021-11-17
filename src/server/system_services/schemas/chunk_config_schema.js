/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'chunk_config_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'chunk_coder_config',
    ],
    properties: {

        // identifiers
        _id: { objectid: true },
        system: { objectid: true },

        // chunk_coder_config defines the methods used for
        // data encoding/decoding for all the chunks belonging to the same tier.
        // This is meant to save a lot of repetition in the chunks schema.
        //
        // @@@ WARNING @@@
        // It is critical to keep the config *immutable* (constant!)
        // since we don't copy this config into the chunks to be efficient in MD size,
        // but if the original config somehow changes, the chunks will not be readable.
        //
        // In order to change encoding a new chunk_config should be created, keeping the old one forever!
        // Changing the chunk_config id in the tier will cause new chunks transcoded from the old chunks.
        chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },

    }
};
