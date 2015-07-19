'use strict';

var _ = require('lodash');

module.exports = Histogram;

var SINGLE_BIN_DEFAULTS = {
    start_val: 0,
    count: 0,
    aggregated_sum: 0,
    label: '',
};

/*
 * Structure: Array of bins each bin contains {label, start_val}
 */
function Histogram(structure) {
    if (typeof structure === 'undefined') {
        throw new Error('Creating a histogram requires structure supplied');
    }

    // allow calling this ctor without new keyword
    if (!(this instanceof Histogram)) {
        return new Histogram(structure);
    }

    this._bins = [];
    for (var i = 0; i < structure.length; ++i) {
        this._bins.push(_.cloneDeep(SINGLE_BIN_DEFAULTS));
        this._bins[i].label = structure[i].label;
        this._bins[i].count = 0;
        this._bins[i].aggregated_sum = 0;
        this._bins[i].start_val = structure[i].start_val;
    }
}

Histogram.prototype.add_value = function(value) {
    for (var i = this._bins.length - 1; i >= 0; --i) {
        if (value >= this._bins[i].start_val) {
            console.log('increaing bin', i);
            this._bins[i].count++;
            this._bins[i].aggregated_sum += value;
            return;
        }
    }
};

Histogram.prototype.get_object_data = function() {
    var ret = [];
    for (var i = 0; i < this._bins.length; ++i) {
        ret.push({});
        ret[i].label = this._bins[i].label;
        ret[i].range = this._bins[i].start_val + (i === this._bins.length - 1 ? '+' : '-' + this._bins[i + 1].start_val);
        ret[i].count = this._bins[i].count;
        ret[i].avg = Math.round(this._bins[i].aggregated_sum / this._bins[i].count);
    }

    return ret;
};

Histogram.prototype.get_string_data = function() {
    var str = '';
    for (var i = 0; i < this._bins.length; ++i) {
        str += this._bins[i].label + ' (' + this._bins[i].start_val + (i === this._bins.length - 1 ? '+' : '-' + this._bins[i + 1].start_val) +
            '): ' + this._bins[i].count + ' avg: ' + Math.round(this._bins[i].aggregated_sum / this._bins[i].count) + '.  ';
    }
    return str;
};
