import template from './func-code.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { funcCodeFiles } from 'model';

class FuncCodeViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.ready = ko.pureComputed(
            () => !!funcCodeFiles()
        );

        this.files = ko.pureComputed(
            () => funcCodeFiles().map(
                (file, i) => Object.assign({
                    expanded: ko.observable(i === 0),
                    size: ko.pureComputed(
                        () => file.content.length
                    ).extend({
                        formatSize: true
                    })
                }, file)
            )
        );

        this.func = ko.pureComputed(
            () => func()
        );

    }

}

export default {
    viewModel: FuncCodeViewModel,
    template: template
};
