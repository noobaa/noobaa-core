import template from './func-code.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { formatSize } from 'utils';

class FuncCodeViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.files = ko.pureComputed(
            () => func().codeFiles.map(
                (file, i) => ({
                    path: file.path,
                    formatted_size: formatSize(file.size),
                    expanded: ko.observable(i === 0),
                    content: file.content
                })
            )
        );

    }

}

export default {
    viewModel: FuncCodeViewModel,
    template: template
};
