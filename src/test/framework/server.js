/* Copyright (C) 2016 NooBaa */
'use strict';
const express = require('express');
const app = express();
const port = 38000;
// const bodyParser = require('body-parser');

// app.use(function(req, res, next) {
//     var data = '';
//     req.on('data', function(chunk) {
//         data += chunk;
//     });
//     req.on('end', function() {
//         req.body = data;
//     });
//     next();
// });

// // app.get('/', (req, res) => res.send('Hello World GET!'));
// app.post('*', (req, res) => {
//     console.warn('Hello World POST!', req.body);
// });

const bodyParser = require("body-parser");

/** bodyParser.urlencoded(options)
 * Parses the text as URL encoded data (which is how browsers tend to send form data from regular forms set to POST)
 * and exposes the resulting object (containing the keys and values) on req.body
 */
app.use(bodyParser.urlencoded({
    extended: true
}));

/**bodyParser.json(options)
 * Parses the text as JSON and exposes the resulting object on req.body.
 */
app.use(bodyParser.json());

app.post("*", function(req, res) {
    console.log(req.body);
    res.end();
});


app.listen(port, () => console.log(`Example app listening on port ${port}!`));
