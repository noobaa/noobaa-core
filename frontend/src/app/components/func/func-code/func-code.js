/* Copyright (C) 2016 NooBaa */

import template from './func-code.html';
import Observer from 'observer';
import ko from 'knockout';
import { formatSize } from 'utils/size-utils';

class FuncCodeViewModel extends Observer {
    constructor({ func }) {
        super();

        this.files = ko.observable();

        if (func()) this.onFiles(func());
        this.observe(func, this.onFiles);
    }

    onFiles(func) {
        this.files(func.codeFiles.map(
            (file, i) => ({
                title: `${file.path} (${formatSize(file.size)})`,
                isCollapsed: ko.observable(i > 0),
                content: ko.observable(file.content)
            })
        ));
    }

    onSave() {
    }
}

export default {
    viewModel: FuncCodeViewModel,
    template: template
};
