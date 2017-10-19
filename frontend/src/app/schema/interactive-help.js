export default {
    type: 'object',
    required: [
        'metadataLoaded',
        'selected'
    ],
    properties: {
        metadataLoaded: {
            type: 'boolean'
        },
        selected: {
            type: ['object', 'null'],
            oneOf:[
                {
                    type: 'object',
                    required: [
                        'minimized',
                        'name'
                    ],
                    properties: {
                        minimized: {
                            type: 'boolean'
                        },
                        name: {
                            type: 'string'
                        },
                        slide: {
                            type: 'integer'
                        }
                    }
                },
                {
                    type: 'null'
                }
            ]
        }
    }
};

