'use strict';

module.exports = {
    id: 'system_history_schema',
    type: 'object',
    required: ['_id', 'time_stamp', 'system_snapshot'],
    properties: {
        _id: {
            format: 'objectid'
        },
        time_stamp: {
            format: 'date'
        },
        system_snapshot: {
            type: 'object',
            additionalProperties: true,
            properties: {}
        }
    }
};
/*
'use strict';

module.exports = {
    id: 'pool_stats_schema',
    type: 'object',
    required: ['_id', 'time_stamp', 'pool_list'],
    properties: {
        _id: {
            format: 'objectid'
        },
        time_stamp: {
            format: 'date'
        },
        pool_list: {
            type: 'array',
            items: {
                type: 'object',
                required: ['name', 'storage_data'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    storage_data: {
                        type: 'object',
                        required: ['used', 'unavailable', 'free'],
                        properties: {
                            used: {
                                oneOf: [{
                                        type: 'integer'
                                    }, {
                                        type: 'object',
                                        properties: {
                                            n: {
                                                type: 'integer',
                                            },
                                            // to support bigger integers we can specify a peta field
                                            // which is considered to be based from 2^50
                                            peta: {
                                                type: 'integer',
                                            }
                                        }
                                    }]
                                    // $ref: 'common_api#/definitions/bigint'
                            },
                            unavailable: {
                                oneOf: [{
                                        type: 'integer'
                                    }, {
                                        type: 'object',
                                        properties: {
                                            n: {
                                                type: 'integer',
                                            },
                                            // to support bigger integers we can specify a peta field
                                            // which is considered to be based from 2^50
                                            peta: {
                                                type: 'integer',
                                            }
                                        }
                                    }]
                                    // $ref: 'common_api#/definitions/bigint'
                            },
                            free: {
                                oneOf: [{
                                        type: 'integer'
                                    }, {
                                        type: 'object',
                                        properties: {
                                            n: {
                                                type: 'integer',
                                            },
                                            // to support bigger integers we can specify a peta field
                                            // which is considered to be based from 2^50
                                            peta: {
                                                type: 'integer',
                                            }
                                        }
                                    }]
                                    // $ref: 'common_api#/definitions/bigint'
                            }
                        }
                    }
                }
            }
        }
    }
};
*/
