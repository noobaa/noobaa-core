/* Copyright (C) 2016 NooBaa */

import './code-viewer-binding';
import template from './code-viewer.html';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';

const langMapping = deepFreeze({
    js: 'javascript',
    json: 'javascript',
    html: 'html',
    xml: 'xml',
    css: 'css',
    less: 'css',
    svg: 'svg'
});

class CodeViewerViewModel  {
    constructor(params) {
        this.code = ko.pureComputed(() =>
            ko.unwrap(params.code)
        );

        this.lang = ko.pureComputed(() =>
            langMapping[ko.unwrap(params.lang)] || 'none'
        );

        this.css = ko.pureComputed(() =>
            `language-${this.lang()}`
        );
    }
}

export default {
    viewModel: CodeViewerViewModel,
    template: template
};
