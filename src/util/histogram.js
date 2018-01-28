/* Copyright (C) 2016 NooBaa */
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
function Histogram(master_label, structure) {
    if (typeof structure === 'undefined') {
        throw new Error('Creating a histogram requires structure supplied');
    }

    // allow calling this ctor without new keyword
    if (!(this instanceof Histogram)) {
        return new Histogram(master_label, structure);
    }

    if (typeof(master_label) !== 'undefined') {
        this._master_label = master_label;
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
            this._bins[i].count += 1;
            this._bins[i].aggregated_sum += value;
            return;
        }
    }
};


Histogram.prototype.add_aggregated_values = function(values) {
    for (var i = this._bins.length - 1; i >= 0; --i) {
        this._bins[i].count += values.count[i];
        this._bins[i].aggregated_sum += values.aggregated_sum[i];
    }
};


Histogram.prototype.get_object_data = function(skip_master_label) {
    var ret = {
        master_label: skip_master_label ? this._master_label : '',
        bins: [],
    };
    for (var i = 0; i < this._bins.length; ++i) {
        ret.bins.push({});
        ret.bins[i].label = this._bins[i].label;
        ret.bins[i].range = this._bins[i].start_val + (i === this._bins.length - 1 ? '+' : '-' + this._bins[i + 1].start_val);
        ret.bins[i].count = this._bins[i].count;
        ret.bins[i].avg = this._bins[i].count ?
            Math.round(this._bins[i].aggregated_sum / this._bins[i].count) :
            0;
    }

    return ret;
};

Histogram.prototype.get_string_data = function() {
    var str = (typeof(this._master_label) === 'undefined' ? '' : this._master_label + '  ');
    for (var i = 0; i < this._bins.length; ++i) {
        str += this._bins[i].label +
            ' (' + this._bins[i].start_val +
            (i === this._bins.length - 1 ? '+' : '-' + this._bins[i + 1].start_val) +
            '): count: ' +
            this._bins[i].count +
            ' avg: ' +
            (this._bins[i].count ? Math.round(this._bins[i].aggregated_sum / this._bins[i].count) : '0') +
            '  ';
    }
    str += '.';
    return str;
};

Histogram.prototype.get_master_label = function() {
    return (typeof(this._master_label) === 'undefined' ? '' : this._master_label);
};
