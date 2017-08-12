/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default class PlacementRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.type = ko.observable();
        this.resourceName = ko.observable();
        this.onlineNodeCount = ko.observable();
        this.capacity = ko.observable();
    }

    onUpdate(pool) {
        this.state(pool.state);
        this.type(pool.type);
        this.resourceName({ text: pool.name, href: pool.url });
        this.onlineNodeCount(pool.onlineNodeCount);
        this.capacity(pool.capacity);

        return this;
    }
}
