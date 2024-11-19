/* Copyright (C) 2024 NooBaa */
'use strict';

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutPublicAccessBlock.html
 * @param {*} req 
 * @param {*} res 
 */
async function put_public_access_block(req, res) {
	// Do something in this function
}

module.exports = {
    handler: put_public_access_block,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};

