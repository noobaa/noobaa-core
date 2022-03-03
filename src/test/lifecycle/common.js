/* Copyright (C) 2022 NooBaa */
'use strict';

const assert = require('assert');

/*
 *  https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html
 */
// ExpiredObjectDeleteMarker -
// Indicates whether Amazon S3 will remove a delete marker with no noncurrent versions.
// If set to true, the delete marker will be expired; if set to false the policy takes no action.
// This cannot be specified with Days or Date in a Lifecycle Expiration Policy.
function marker_lifecycle_configuration(Bucket, Key) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    ExpiredObjectDeleteMarker: true,
                },
                Filter: {
                    Prefix: Key,
                },
                Status: 'Enabled',
            }, ],
        },
    };
}

function empty_filter_marker_lifecycle_configuration(Bucket) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    ExpiredObjectDeleteMarker: true,
                },
                Status: 'Enabled',
            }, ],
        },
    };
}
exports.empty_filter_marker_lifecycle_configuration = empty_filter_marker_lifecycle_configuration;

function date_lifecycle_configuration(Bucket, Key) {
    const now = new Date(Date.now());
    const midnight = new Date(now.setUTCHours(0, 0, 0, 0));

    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Date: midnight.toISOString(),
                },
                Filter: {
                    Prefix: Key,
                },
                Status: 'Enabled',
            }, ],
        },
    };
}
exports.date_lifecycle_configuration = date_lifecycle_configuration;

function date_lifecycle_configuration_and_tags(Bucket, Prefix, tagging) {
    const now = new Date(Date.now());
    const midnight = new Date(now.setUTCHours(0, 0, 0, 0));
    const Tags = tagging.map((e, _) => ({Key: e.key, Value: e.value}));

    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Date: midnight.toISOString(),
                },
                Filter: {
                    And: {
                        Tags,
                        Prefix,
                    }
                },
                Status: 'Enabled',
            }, ],
        },
    };
}
exports.date_lifecycle_configuration_and_tags = date_lifecycle_configuration_and_tags;

function size_less_lifecycle_configuration(Bucket, ObjectSizeLessThan) {
    const now = new Date(Date.now());
    const midnight = new Date(now.setUTCHours(0, 0, 0, 0));

    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Date: midnight.toISOString(),
                },
                Filter: {
                    ObjectSizeLessThan,
                },
                Status: 'Enabled',
            }, ],
        },
    };
}
exports.size_less_lifecycle_configuration = size_less_lifecycle_configuration;

function size_less_days_lifecycle_configuration(Bucket, ObjectSizeLessThan, Days) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Days,
                },
                Filter: {
                    ObjectSizeLessThan,
                },
                Status: 'Enabled',
            }, ],
        },
    };
}
exports.size_less_days_lifecycle_configuration = size_less_days_lifecycle_configuration;

function tag_days_lifecycle_configuration(Bucket, Days, tag) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Days,
                },
                Filter: {
                    Tag: {
                        Key: tag.key,
                        Value: tag.value,
                    },
                },
                Status: 'Enabled',
            }, ],
        },
    };
}
exports.tag_days_lifecycle_configuration = tag_days_lifecycle_configuration;

function size_gt_lt_lifecycle_configuration(Bucket, gt, lt) {
    const now = new Date(Date.now());
    const midnight = new Date(now.setUTCHours(0, 0, 0, 0));

    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Date: midnight.toISOString(),
                },
                Filter: {
                    ObjectSizeLessThan: lt,
                    ObjectSizeGreaterThan: gt
                },
                Status: 'Enabled',
            }, ],
        },
    };
}
exports.size_gt_lt_lifecycle_configuration = size_gt_lt_lifecycle_configuration;


function days_lifecycle_configuration(Bucket, Key) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Days: 17,
                },
                Filter: {
                    Prefix: Key,
                },
                Status: 'Enabled',
            }, ],
        },
    };
}

function tags_lifecycle_configuration(Bucket, Key, Value) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Days: 17,
                },
                Filter: {
                    Tag: {
                        Key,
                        Value,
                    },
                },
                Status: 'Enabled',
            }, ],
        },
    };
}

function and_tags_lifecycle_configuration(Bucket, Key1, Value1, Key2, Value2) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Days: 17,
                },
                Filter: {
                    And: {
                        Tags: [
                            {
                                Key: Key1,
                                Value: Value1,
                            },
                            {
                                Key: Key2,
                                Value: Value2,
                            },
                        ]
                    }
                },
                Status: 'Enabled',
            }, ],
        },
    };
}

function empty_filter_lifecycle_configuration(Bucket) {
    const ID = 'rule_id';
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                ID,
                Expiration: {
                    Days: 17,
                },
                Filter: {},
                Status: 'Enabled',
            }, ],
        },
    };
}

function and_tags_prefix_lifecycle_configuration(Bucket, Key, Key1, Value1, Key2, Value2) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Days: 17,
                },
                Filter: {
                    And: {
                        Prefix: Key,
                        Tags: [
                            {
                                Key: Key1,
                                Value: Value1,
                            },
                            {
                                Key: Key2,
                                Value: Value2,
                            },
                        ]
                    }
                },
                Status: 'Enabled',
            }, ],
        },
    };
}

function filter_size_lifecycle_configuration(Bucket) {
    const ID = 'rule_id';
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                ID,
                Expiration: {
                    Days: 17,
                },
                Filter: {
                    ObjectSizeGreaterThan: 500,
                },
                Status: 'Enabled',
            }, ],
        },
    };
}

function and_prefix_size_lifecycle_configuration(Bucket, Key) {
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                Expiration: {
                    Days: 17,
                },
                Filter: {
                    And: {
                        Prefix: Key,
                        ObjectSizeGreaterThan: 500,
                        ObjectSizeLessThan: 64000,
                    }
                },
                Status: 'Enabled',
            }, ],
        },
    };
}

function rules_length_lifecycle_configuration(Bucket, Key) {
    const now = new Date(Date.now());
    const midnight = new Date(now.setUTCHours(0, 0, 0, 0));

    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [
                {
                    ID: 'rule1',
                    Expiration: {
                        Days: 17,
                    },
                    Filter: {
                        Prefix: Key,
                    },
                    Status: 'Enabled',
                },
                {
                    ID: 'rule2',
                    Expiration: {
                        Date: midnight.toISOString(),
                    },
                    Filter: {
                        Prefix: Key,
                    },
                    Status: 'Enabled',
                }
            ],
        },
    };
}


function id_lifecycle_configuration(Bucket, Key) {
    const ID = 'rule_id';
    return {
        Bucket,
        LifecycleConfiguration: {
            Rules: [{
                ID,
                Expiration: {
                    Days: 17,
                },
                Filter: {
                    Prefix: Key,
                },
                Status: 'Enabled',
            }, ],
        },
    };
}

async function put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3) {
    const putLifecycleResult = await s3.putBucketLifecycleConfiguration(putLifecycleParams).promise();
    console.log('put lifecycle params:', putLifecycleParams, 'result', putLifecycleResult);
    for (const rule of putLifecycleParams.LifecycleConfiguration.Rules) {
        console.log("put lifecycle ID", rule.ID, "expiration", rule.Expiration, "filter", rule.Filter);
    }
    const lifecycleParams = {
        Bucket,
    };
    const getLifecycleResult = await s3.getBucketLifecycleConfiguration(lifecycleParams).promise();
    console.log('get lifecycle params:', lifecycleParams, 'result', getLifecycleResult);
    for (const rule of getLifecycleResult.Rules) {
        console.log("get lifecycle ID", rule.ID, "expiration", rule.Expiration, "filter", rule.Filter);
    }
    const deleteLifecycleResult = await s3.deleteBucketLifecycle(lifecycleParams).promise();
    console.log('delete lifecycle params:', lifecycleParams, 'result', deleteLifecycleResult);

    return getLifecycleResult;
}

exports.test_rules_length = async function(Bucket, Key, s3) {
    const putLifecycleParams = rules_length_lifecycle_configuration(Bucket, Key);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualRulesLength = getLifecycleResult.Rules.length;
    const expectedRulesLength = putLifecycleParams.LifecycleConfiguration.Rules.length;
    console.log('get lifecycle rules length:', actualRulesLength, ' expected:', expectedRulesLength);

    assert(getLifecycleResult.Rules.length === putLifecycleParams.LifecycleConfiguration.Rules.length, 'number of rules');
};

exports.test_expiration_marker = async function(Bucket, Key, s3) {
    const putLifecycleParams = marker_lifecycle_configuration(Bucket, Key);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualMarker = getLifecycleResult.Rules[0].Expiration.ExpiredObjectDeleteMarker;
    const expectedMarker = putLifecycleParams.LifecycleConfiguration.Rules[0].Expiration.ExpiredObjectDeleteMarker;
    console.log('get lifecycle expiration marker:', actualMarker, ' expected:', expectedMarker);

    assert(actualMarker === expectedMarker, 'expiration marker');
};

exports.test_expiration_date = async function(Bucket, Key, s3) {
    const putLifecycleParams = date_lifecycle_configuration(Bucket, Key);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualDate = new Date(getLifecycleResult.Rules[0].Expiration.Date);
    const expectedDate = new Date(putLifecycleParams.LifecycleConfiguration.Rules[0].Expiration.Date);
    console.log('get lifecycle expiration date:', actualDate, '(', actualDate.getTime(), ') expected:', expectedDate, '(', expectedDate.getTime(), ')');

    assert(actualDate.getTime() === expectedDate.getTime(), 'expiration date');
};

exports.test_rule_status = async function(Bucket, Key, s3) {
    const putLifecycleParams = date_lifecycle_configuration(Bucket, Key);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualStatus = getLifecycleResult.Rules[0].Status;
    const expectedStatus = putLifecycleParams.LifecycleConfiguration.Rules[0].Status;
    console.log('get lifecycle status:', actualStatus, ' expected:', expectedStatus);

    assert(actualStatus === expectedStatus, 'rule status');
};

exports.test_rule_filter = async function(Bucket, Key, s3) {
    const putLifecycleParams = date_lifecycle_configuration(Bucket, Key);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualFilter = getLifecycleResult.Rules[0].Filter;
    const expectedFilter = putLifecycleParams.LifecycleConfiguration.Rules[0].Filter;
    console.log('get rule filter:', actualFilter, ' expected:', expectedFilter);

    assert.deepEqual(actualFilter, expectedFilter, 'rule filter');
};

exports.test_expiration_days = async function(Bucket, Key, s3) {
    const putLifecycleParams = days_lifecycle_configuration(Bucket, Key);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualDays = getLifecycleResult.Rules[0].Expiration.Days;
    const expectedDays = putLifecycleParams.LifecycleConfiguration.Rules[0].Expiration.Days;
    console.log('get lifecycle expiration days:', actualDays, ' expected:', expectedDays);

    assert(actualDays === expectedDays, 'expiration days');
};

exports.test_filter_tag = async function(Bucket, Key, Value, s3) {
    const putLifecycleParams = tags_lifecycle_configuration(Bucket, Key, Value);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualTag = getLifecycleResult.Rules[0].Filter.Tag;
    const expectedTag = putLifecycleParams.LifecycleConfiguration.Rules[0].Filter.Tag;
    console.log('get filter tag:', actualTag, ' expected:', expectedTag);

    assert.deepEqual(actualTag, expectedTag, 'filter tag');
};

exports.test_and_tag = async function(Bucket, Key1, Value1, Key2, Value2, s3) {
    const putLifecycleParams = and_tags_lifecycle_configuration(Bucket, Key1, Value1, Key2, Value2);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualAnd = getLifecycleResult.Rules[0].Filter.And;
    const expectedAnd = putLifecycleParams.LifecycleConfiguration.Rules[0].Filter.And;
    console.log('get and tag:', actualAnd, ' expected:', expectedAnd);

    assert.deepEqual(actualAnd, expectedAnd, 'filter and tag');
};

exports.test_and_tag_prefix = async function(Bucket, Key, Key1, Value1, Key2, Value2, s3) {
    const putLifecycleParams = and_tags_prefix_lifecycle_configuration(Bucket, Key, Key1, Value1, Key2, Value2);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualAnd = getLifecycleResult.Rules[0].Filter.And;
    const expectedAnd = putLifecycleParams.LifecycleConfiguration.Rules[0].Filter.And;
    console.log('get and tags prefix:', actualAnd, ' expected:', expectedAnd);

    assert.deepEqual(actualAnd, expectedAnd, 'filter and tags prefix');
};

exports.test_rule_id = async function(Bucket, Key, s3) {
    const putLifecycleParams = id_lifecycle_configuration(Bucket, Key);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualId = getLifecycleResult.Rules[0].ID;
    const expectedId = putLifecycleParams.LifecycleConfiguration.Rules[0].ID;
    console.log('get rule id:', actualId, ' expected:', expectedId);

    assert.deepEqual(actualId, expectedId, 'rule id');
};

exports.test_empty_filter = async function(Bucket, s3) {
    const putLifecycleParams = empty_filter_lifecycle_configuration(Bucket);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualFilter = getLifecycleResult.Rules[0].Filter;
    const expectedFilter = putLifecycleParams.LifecycleConfiguration.Rules[0].Filter;
    console.log('get empty filter:', actualFilter, ' expected:', expectedFilter);

    assert.deepEqual(actualFilter, expectedFilter, 'empty filter');
};

exports.test_filter_size = async function(Bucket, s3) {
    const putLifecycleParams = filter_size_lifecycle_configuration(Bucket);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualSize = getLifecycleResult.Rules[0].Filter.ObjectSizeGreaterThan;
    const expectedSize = putLifecycleParams.LifecycleConfiguration.Rules[0].Filter.ObjectSizeGreaterThan;
    console.log('get filter size:', actualSize, ' expected:', expectedSize);

    assert.deepEqual(actualSize, expectedSize, 'filter size');
};

exports.test_and_prefix_size = async function(Bucket, Key, s3) {
    const putLifecycleParams = and_prefix_size_lifecycle_configuration(Bucket, Key);
    const getLifecycleResult = await put_get_lifecycle_configuration(Bucket, putLifecycleParams, s3);

    const actualFilter = getLifecycleResult.Rules[0].Filter;
    const expectedFilter = putLifecycleParams.LifecycleConfiguration.Rules[0].Filter;
    console.log('get and prefix size filter:', actualFilter, ' expected:', expectedFilter);

    assert(actualFilter.Tags === expectedFilter.Tags, 'and prefix size filter - Tags');
    assert(actualFilter.Prefix === expectedFilter.Prefix, 'and prefix size filter - Prefix');
    assert(actualFilter.ObjectSizeGreaterThan === expectedFilter.ObjectSizeGreaterThan, 'and prefix size filter - ObjectSizeGreaterThan');
    assert(actualFilter.ObjectSizeLessThan === expectedFilter.ObjectSizeLessThan, 'and prefix size filter - ObjectSizeLessThan');
};
