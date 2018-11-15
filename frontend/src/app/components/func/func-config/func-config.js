/* Copyright (C) 2016 NooBaa */

import template from './func-config.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { updateFuncConfig } from 'actions';

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

        const config = ko.pureComputed(() =>
            func() ? func().config : {}
        );

        this.func = func;
        this.runtimeOptions = runtimeOptions;
        this.memorySizeOptions = memorySizeOptions;
        this.name = ko.pureComputed(() =>
            func() ? func().name : ''
        );
        this.version = ko.pureComputed(() =>
            func() ? func().version : ''
        );
        this.runtime = ko.observableWithDefault(() =>
            config().runtime
        );
        this.runtimeOptions = ko.pureComputed(() => [
            { value: this.runtime() }
        ]);
        this.handler = ko.observableWithDefault(() =>
            config().handler
        );
        this.memorySize = ko.observableWithDefault(() =>
            config().memory_size
        );
        this.timeout = ko.observableWithDefault(() =>
            config().timeout
        );
        this.description = ko.observableWithDefault(() =>
            config().description
        );
    }

    applyChanges() {
        const config = {
            runtime: this.runtime(),
            handler: this.handler(),
            memory_size: this.memorySize(),
            timeout: parseInt(this.timeout(), 10),
            description: this.description()
        };

        updateFuncConfig(this.name(), this.version(), config);
    }

}

export default {
    viewModel: FuncConfigViewModel,
    template: template
};
