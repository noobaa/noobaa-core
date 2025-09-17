/* Copyright (C) 2016 NooBaa */
'use strict';
const express = require('express');
const app = express();
const port = 38000;

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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("*", function(req, res) {
    console.log(req.body);
    res.end();
});


app.listen(port, () => console.log(`Example app listening on port ${port}!`));
