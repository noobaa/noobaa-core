/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const kmeans = require('../../util/kmeans');

mocha.describe('kmeans errors', function() {

    mocha.it('should throw an error if there aren\'t 2 arguments', () => {
        let was_thrown = false;
        try {
            kmeans.run();
        } catch (err) {
            was_thrown = true;
        }
        assert(was_thrown, 'should throw an error if there aren\'t 2 arguments');
    });

    mocha.it('should throw an error if there isn\'t options', () => {
        let was_thrown = false;
        try {
            kmeans.run([]);
        } catch (err) {
            was_thrown = true;
        }
        assert(was_thrown, 'should throw an error if there isn\'t options');
    });

    mocha.it('should throw an error if K isn\'t in options', () => {
        let was_thrown = false;
        try {
            kmeans.run([], { sloth: 1 });
        } catch (err) {
            was_thrown = true;
        }
        assert(was_thrown, 'should throw an error if K isn\'t in options');
    });

    mocha.it('should throw an error if K isn\'t in good range', () => {
        let was_thrown = false;
        try {
            kmeans.run([], { k: 0 });
        } catch (err) {
            was_thrown = true;
        }
        assert(was_thrown, 'should throw an error if K isn\'t in good range');
    });

    mocha.it('should throw an error if K larger than number of vectors', () => {
        let was_thrown = false;
        try {
            kmeans.run([], { k: 1 });
        } catch (err) {
            was_thrown = true;
        }
        assert(was_thrown, 'should throw an error if K larger than number of vectors');
    });

    mocha.it('should throw an error if distance isn\'t a function', () => {
        let was_thrown = false;
        try {
            kmeans.run([1], { k: 1, distance: {} });
        } catch (err) {
            was_thrown = true;
        }
        assert(was_thrown, 'should throw an error if distance isn\'t a function');
    });

    mocha.it('should throw an error if distance isn\'t a function with 2 parameters', () => {
        let was_thrown = false;
        try {
            kmeans.run([1], { k: 1, distance: (a, b, c) => (a + b + c) });
        } catch (err) {
            was_thrown = true;
        }
        assert(was_thrown, 'should throw an error if distance isn\'t a function with 2 parameters');
    });

});

mocha.describe('kmeans working', function() {

    mocha.it('handle noise in vector', () => {
        const result = kmeans.run([
            [26],
            [4],
            [1992],
            [9999]
        ], { k: 2 });

        const expected_response = [{
                centroid: [674],
                cluster: [
                    [26],
                    [4],
                    [1992],
                ],
                clusterInd: [0, 1, 2]
            },
            {
                centroid: [9999],
                cluster: [
                    [9999]
                ],
                clusterInd: [3]
            }
        ];

        const noise_cluster = _.find(result, cluster => _.isEmpty(_.difference(cluster.centroid, expected_response[1].centroid)));
        const regular_cluster = _.find(result, cluster => _.isEmpty(_.difference(cluster.centroid, expected_response[0].centroid)));

        assert(result.length === 2, 'KMEANS did not divide to two clusters');
        assert(noise_cluster, 'KMEANS did not create a noise cluster with expected centroid');
        assert(regular_cluster, 'KMEANS did not create a regular cluster with expected centroid');
        assert(_.isEmpty(_.difference(noise_cluster.clusterInd, expected_response[1].clusterInd)),
            'KMEANS did not create a noise cluster with expected vectors');
        assert(_.isEmpty(_.difference(regular_cluster.clusterInd, expected_response[0].clusterInd)),
            'KMEANS did not create a regular cluster with expected vectors');
        assert(_.isEmpty(_.difference(_.flatten(noise_cluster.cluster), _.flatten(expected_response[1].cluster))),
            'KMEANS did not create a noise cluster with expected vectors');
        assert(_.isEmpty(_.difference(_.flatten(regular_cluster.cluster), _.flatten(expected_response[0].cluster))),
            'KMEANS did not create a regular cluster with expected vectors');

    });

});
