/* Copyright (C) 2016 NooBaa */
'use strict';


class MultiMarker {

    constructor({ start, end } = {}) {
        this.start = start;
        this.end = end;
    }

    push_range(range) {
        if (!range) return;
        // assuming that this.start and this.end are always set together
        this.start = this._min(this.start, range.start);
        this.end = this._max(this.end, range.end);
    }

    pop_range() {
        // pop one range out. since we work with a single range we just return the range and reset.
        if (this.start || this.end) {
            const range = { start: this.start, end: this.end };
            this.start = null;
            this.end = null;
            return range;
        }
    }

    get_total_range() {
        if (this.start || this.end) {
            return { start: this.start, end: this.end };
        }
    }

    _min(a, b) {
        if (!a) return b;
        if (!b) return a;
        if (a <= b) return a;
        return b;
    }

    _max(a, b) {
        if (!a) return b;
        if (!b) return a;
        if (a >= b) return a;
        return b;
    }

}




exports.MultiMarker = MultiMarker;
