/* Copyright (C) 2016 NooBaa */

import template from './func-code.html';
import Observer from 'observer';
import ko from 'knockout';
import { pick } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { updateFuncCode } from 'actions';

class FuncCodeViewModel extends Observer {
    constructor({ func }) {
        super();

        this.name = ko.observable();
        this.version = ko.observable();
        this.files = ko.observable();

        if (func()) this.onFiles(func());
        this.observe(
            func,
            this.onFiles
        );
    }

    onFiles({ name, version, codeFiles }) {
        this.name(name);
        this.version(version);
        this.files(codeFiles.map(
            (file, i) => ({
                path: file.path,
                title: `${file.path} (${formatSize(file.size)})`,
                isCollapsed: ko.observable(i > 0),
                content: ko.observable(file.content)
            })
        ));
    }

    onSave() {
        const code = this.files()
            .filter(file => file.content())
            .map(file => ko.deepUnwrap(pick(file, ['path', 'content'])));

        updateFuncCode(this.name(), this.version(), code);
    }
}

export default {
    viewModel: FuncCodeViewModel,
    template: template
};
