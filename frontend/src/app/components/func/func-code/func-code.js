/* Copyright (C) 2016 NooBaa */

import template from './func-code.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { formatSize } from 'utils/size-utils';

class FuncCodeViewModel extends BaseViewModel {
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
