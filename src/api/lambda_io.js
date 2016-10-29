/* Copyright (C) 2016 NooBaa */
'use strict';

class LambdaIO {

    invoke({
        client,
        name,
        event,
    }) {
        return client.lambda.invoke_func({
            name,
            event,
        });
    }

}

module.exports = LambdaIO;
