export default function register(ko) {
    ko.extenders.tween = require('./tween');
    ko.extenders.formatSize = require('./format-size');
    ko.extenders.formatNumber = require('./format-number');
    ko.extenders.formatTime = require('./format-time');
    ko.extenders.isModified = require('./is-modified');
}
