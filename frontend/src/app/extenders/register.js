export default function register(ko) {
    ko.extenders.tween = require('./tween');
    ko.extenders.formatSize = require('./formatSize');
    ko.extenders.formatNumber = require('./formatNumber');
}