/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default class SpilloverResourceRowViewModel {
    constructor() {
        this.status = ko.observable();
        this.type = ko.observable();
        this.name = ko.observable();
        this.buckets = ko.observable();
        this.usage = ko.observable();
    }

    onUpdate({ status, type, name, buckets, usage }) {
        this.status(status);
        this.type(type);
        this.name(name);
        this.buckets(buckets);
        this.usage(usage);

        return this;
    }
}
