/* Copyright (C) 2016 NooBaa */
'use strict';

/*
Synchronous implementation of the k-means clustering algorithm.

The kmeans function takes as input the number k of clusters and a list of N
input vectors and it outputs an object with two attributes:
  - centroids: an Array of k vectors containing the centroid of each cluster
  - assignments: An Array of size N representing for each input vector the
    index of the cluster

The kmeans will return an error if:
  - N < k
  - The number of different input vectors is smaller than k
*/

const _ = require('lodash');

/**
 * Compute the Euclidean distance
 *
 * @param {Array} a
 * @param {Array} b
 * @api private
 */

function euclidianDistance(a, b) {
    if (a.length !== b.length) {
        return (new Error('The vectors must have the same length'));
    }
    let d = 0.0;
    for (let i = 0, max = a.length; i < max; ++i) {
        d += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(d);
}

class Group {
    constructor() {
        this.centroidMoved = true;
    }

    initCluster() {
        this.cluster = []; // dimensions
        this.clusterInd = []; // index
    }

    /**
     * Define Centroid
     *  - if they exist, calculate the new position
     *  - otherwise, randomly choose one existing item
     */
    defineCentroid(indexes, v) {
        this.centroidOld = (this.centroid) ? this.centroid : [];
        if (this.centroid && this.cluster.length > 0) {
            this.calculateCentroid();
        } else { // random selection
            const i = Math.floor(Math.random() * indexes.length);
            this.centroidIndex = indexes[i];
            indexes.splice(i, 1);
            this.centroid = [];
            if (_.isArray(v[this.centroidIndex])) {
                for (let j = 0, max = v[this.centroidIndex].length; j < max; ++j) {
                    this.centroid[j] = v[this.centroidIndex][j];
                }
            } else { // only one dimension
                this.centroid[0] = v[this.centroidIndex];
            }
        }
        // Centroid has moved if old value != new value
        this.centroidMoved = !_.isEqual(this.centroid, this.centroidOld);
    }

    calculateCentroid() {
        this.centroid = [];
        for (let i = 0; i < this.cluster.length; ++i) { // loop through the cluster elements
            for (let j = 0, max = this.cluster[i].length; j < max; ++j) { // loop through the dimensions
                this.centroid[j] = this.centroid[j] ?
                    this.centroid[j] + this.cluster[i][j] :
                    this.cluster[i][j];
            }
        }
        for (let i = 0, max = this.centroid.length; i < max; ++i) {
            this.centroid[i] /= this.cluster.length; // average
        }
        return this;
    }

    distanceObjects(v, distanceFunction) {
        if (!this.distances) {
            this.distances = [];
        }
        for (let i = 0, max = v.length; i < max; ++i) {
            this.distances[i] = distanceFunction(this.centroid, v[i]);
        }
    }
}

class Clusterize {
    constructor(vector, options) {
        if (!options || !vector) {
            throw new Error('Provide 2 arguments: vector, options');
        }
        if (!options.k || options.k < 1) {
            throw new Error('Provide a correct number k of clusters');
        }
        if (options.distance &&
            (typeof options.distance !== 'function' || options.distance.length !== 2)) {
            throw new Error('options.distance must be a function with two arguments');
        }
        if (!_.isArray(vector)) {
            throw new Error('Provide an array of data');
        }

        this.options = options;
        this.v = this.checkV(vector);
        this.k = this.options.k;
        this.distanceFunction = this.options.distance || euclidianDistance;
        if (this.v.length < this.k) {
            const errMessage = `The number of points must be greater than
      the number k of clusters`;
            throw new Error(errMessage);
        }

        this.initialize(); // initialize the group arrays

    }

    iterate(first_step) {
        if (first_step) this.moved = -1;
        if (this.moved === 0) {
            return this.output(); // converged if 0 centroid has moved
        }
        this.moved = 0;
        for (let i = 0, max = this.groups.length; i < max; ++i) {
            this.groups[i].defineCentroid(this.indexes, this.v); // define the new centroids
            this.groups[i].distanceObjects(this.v, this.distanceFunction); // distances from centroids to items
        }
        this.clustering(); // clustering by choosing the centroid the closest of each item
        for (let i = 0, max = this.groups.length; i < max; ++i) {
            // check how many centroids have moved in this iteration
            if (this.groups[i].centroidMoved) {
                this.moved += 1;
            }
        }
        return this.iterate();
    }

    checkV(v) {
        let dim = 1;
        if (_.isArray(v[0])) {
            dim = v[0].length;
        }
        for (let i = 0, max = v.length; i < max; ++i) {
            if (_.isArray(v[i])) {
                if (v[i].length !== dim) {
                    throw new Error('All the elements must have the same dimension');
                }
                for (let j = 0, max2 = v[i].length; j < max2; ++j) {
                    v[i][j] = Number(v[i][j]);
                    if (isNaN(v[i][j])) {
                        throw new Error('All the elements must be float type');
                    }
                }
            } else {
                if (dim !== 1) {
                    throw new Error('All the elements must have the same dimension');
                }
                v[i] = Number(v[i]);
                if (isNaN(v[i])) {
                    throw new Error('All the elements must be float type');
                }
            }
        }
        return v;
    }

    initialize() {
        this.groups = [];
        for (let i = 0, max = this.k; i < max; ++i) {
            this.groups[i] = new Group(this);
        }
        this.indexes = []; // used to choose randomly the initial centroids
        for (let i = 0, max = this.v.length; i < max; ++i) {
            this.indexes[i] = i;
        }
        return this;
    }

    clustering() {
        for (let j = 0, max = this.groups.length; j < max; ++j) {
            this.groups[j].initCluster();
        }
        for (let i = 0, max = this.v.length; i < max; ++i) {
            let min = this.groups[0].distances[i];
            let indexGroup = 0;
            for (let j = 1, max2 = this.groups.length; j < max2; ++j) {
                if (this.groups[j].distances[i] < min) {
                    min = this.groups[j].distances[i];
                    indexGroup = j;
                }
            }
            this.groups[indexGroup].cluster.push(this.v[i]);
            this.groups[indexGroup].clusterInd.push(i);
        }
        return this;
    }

    output() {
        const out = [];
        for (let j = 0, max = this.groups.length; j < max; ++j) {
            out[j] = _.pick(this.groups[j], 'centroid', 'cluster', 'clusterInd');
        }
        return out;
    }
}

function run(vector, options) {
    const clusters = new Clusterize(vector, options);
    return clusters.iterate(true); /* first_step = true */
}

exports.run = run;
