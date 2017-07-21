/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default class InternalResourceRowViewModel {
    constructor() {
        this.status = ko.observable();
        this.name = ko.observable();
        this.buckets = ko.observable();
        this.usage = ko.observable();
    }

    onUpdate({ status, name, buckets, usage }) {
        this.status(status);
        this.name(name);
        this.buckets(buckets);
        this.usage(usage);

        return this;
    }
}
