import template from './func-config.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';
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

class FuncConfigViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.func = ko.pureComputed(
            () => func()
        );

        this.runtimeOptions = runtimeOptions;
        this.memorySizeOptions = memorySizeOptions;

        this.runtime = ko.observable(func().config.runtime);
        this.handler = ko.observable(func().config.handler);
        this.memorySize = ko.observable(func().config.memory_size);
        this.timeout = ko.observable(func().config.timeout);
        this.description = ko.observable(func().config.description);

    }

    save() {
        updateFunc({
            name: this.func().config.name,
            version: this.func().config.version,
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
