/* Copyright (C) 2016 NooBaa */

export default function register(ko) {
    ko.extenders.tween = require('./tween').default;
    ko.extenders.formatSize = require('./format-size').default;
    ko.extenders.formatNumber = require('./format-number').default;
    ko.extenders.formatTime = require('./format-time').default;
    ko.extenders.isModified = require('./is-modified').default;
}
