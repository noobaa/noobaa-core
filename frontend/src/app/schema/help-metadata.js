export const slide = {
    type: 'object',
    required: [
        'title',
        'image'
    ],
    properties: {
        title: {
            type: 'string'
        },
        desc: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    enum: [
                        'TEXT',
                        'BULLETS',
                        'LIST'
                    ]
                },
                content: {
                    type: 'array',
                    items: {
                        Type: 'string'
                    }
                }
            }
        },
        image: {
            type: 'string',
            format: 'uri'
        }
    }
};

export const category = {
    type: 'object',
    required: [
        'order',
        'label'
    ],
    properties: {
        order: {
            type: 'integer'
        },
        label: {
            type: 'string'
        }
    }
};

export const topic = {
    oneOf: [
        {
            type: 'object',
            required: [
                'name',
                'category',
                'kind',
                'title',
                'subtitle',
                'keywords',
                'uri',
                'body'
            ],
            properties: {
                name: {
                    type: 'string'
                },
                category: {
                    type: 'string'

                },
                kind: {
                    const: 'ARTICLE'
                },
                title: {
                    type: 'string'
                },
                subtitle: {
                    type: 'string',
                },
                keywords: [
                    {
                        type: 'string'
                    }
                ],
                uri: {
                    type: 'string',
                    format: 'uri'
                },
                body: {
                    type: 'string'
                }
            }
        },
        {
            type: 'object',
            required: [
                'name',
                'category',
                'kind',
                'title',
                'subtitle',
                'keywords',
                'uri',
                'slides'
            ],
            properties: {
                name: {
                    type: 'string'
                },
                category: {
                    type: 'string'

                },
                kind: {
                    const: 'SLIDES'
                },
                title: {
                    type: 'string'
                },
                subtitle: {
                    type: 'string',
                },
                keywords: [
                    {
                        type: 'string'
                    }
                ],
                uri: {
                    type: 'string',
                    format: 'uri'
                },
                slides: {
                    type: 'array',
                    items: {
                        $ref: '#/def/helpMetadata/slide'
                    }
                }
            }
        },
        {
            type: 'object',
            required: [
                'name',
                'category',
                'kind',
                'title',
                'subtitle',
                'keywords',
                'uri'
            ],
            properties: {
                name: {
                    type: 'string'
                },
                category: {
                    type: 'string'

                },
                kind: {
                    type: 'string',
                    enum: [
                        'VIDEO',
                        'LINK'
                    ]
                },
                title: {
                    type: 'string'
                },
                subtitle: {
                    type: 'string',
                },
                keywords: [
                    {
                        type: 'string'
                    }
                ],
                uri: {
                    type: 'string',
                    format: 'uri'
                }
            }
        }
    ]
};

export const helpMetadata = {
    type: 'object',
    required: [
        'version',
        'categories',
        'topics'
    ],
    properties: {
        version: {
            type: 'string'
        },
        categories: {
            type: 'object',
            additionalProperties: {
                $ref: '#/def/helpMetadata/category'
            }
        },
        topics: {
            type: 'object',
            additionalProperties: {
                $ref: '#/def/helpMetadata/topic'
            }
        }
    }
};

