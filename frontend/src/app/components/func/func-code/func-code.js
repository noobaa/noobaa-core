import template from './func-code.html';
import Disposable from 'disposable';
import ko from 'knockout';

class FuncCodeViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.files = ko.pureComputed(
            () => func().codeFiles.map(
                (file, i) => Object.assign({
                    expanded: ko.observable(i === 0),
                    formatted_size: ko.pureComputed(
                        () => file.size
                    ).extend({
                        formatSize: true
                    })
                }, file)
            )
        );

    }

}

export default {
    viewModel: FuncCodeViewModel,
    template: template
};
