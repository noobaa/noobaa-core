/* Copyright (C) 2016 NooBaa */

import template from './func-config.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { updateFunc } from 'actions';

const runtimeOptions = deepFreeze([
    {
        value: 'nodejs6'
    }
]);

const memorySizeOptions = deepFreeze([
    {
        value: 128,
        label: '128 MB'
    },
    {
        value: 256,
        label: '256 MB'
    },
    {
        value: 512,
        label: '512 MB'
    }
]);

class FuncConfigViewModel extends BaseViewModel {
    constructor({ func }) {
        super();

        this.func = func;
        this.runtimeOptions = runtimeOptions;
        this.memorySizeOptions = memorySizeOptions;

        let config = ko.pureComputed(
            () => func().config || {}
        );

        this.runtime = ko.observableWithDefault(
            () => config().runtime
        );

        this.handler = ko.observableWithDefault(
            () => config().handler
        );

        this.handler = ko.observableWithDefault(
            () => config().handler
        );

        this.memorySize = ko.observableWithDefault(
            () => config().memory_size
        );

        this.timeout = ko.observableWithDefault(
            () => config().timeout
        );
        this.description = ko.observableWithDefault(
            () => config().description
        );

    }

    applyChanges() {
        let { name, version } = this.func().config;

        updateFunc({
            name: name,
            version: version,
            runtime: this.runtime(),
            handler: this.handler(),
            memory_size: this.memorySize(),
            timeout: parseInt(this.timeout(), 10),
            description: this.description()
        });
    }

}

export default {
    viewModel: FuncConfigViewModel,
    template: template
};
