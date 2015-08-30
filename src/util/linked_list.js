'use strict';

module.exports = LinkedList;

function LinkedList(name) {
    name = name || '';
    this.next = '_lln_' + name;
    this.prev = '_llp_' + name;
    this.head = '_llh_' + name;
    this.length = 0;
    this[this.next] = this;
    this[this.prev] = this;
    this[this.head] = this;
}

LinkedList.prototype.insert_after = function(item, new_item) {
    this.check_item(item);
    this.check_new_item(new_item);
    var next = item[this.next];
    new_item[this.next] = next;
    new_item[this.prev] = item;
    new_item[this.head] = this;
    next[this.prev] = new_item;
    item[this.next] = new_item;
    this.length++;
    return true;
};

LinkedList.prototype.insert_before = function(item, new_item) {
    this.check_item(item);
    this.check_new_item(new_item);
    var prev = item[this.prev];
    new_item[this.next] = item;
    new_item[this.prev] = prev;
    new_item[this.head] = this;
    prev[this.next] = new_item;
    item[this.prev] = new_item;
    this.length++;
    return true;
};

LinkedList.prototype.remove = function(item) {
    var next = item[this.next];
    var prev = item[this.prev];
    if (!next || !prev) {
        return false; // already removed
    }
    this.check_item(item);
    next[this.prev] = prev;
    prev[this.next] = next;
    item[this.next] = null;
    item[this.prev] = null;
    item[this.head] = null;
    this.length--;
    return true;
};

LinkedList.prototype.get_next = function(item) {
    var next = item[this.next];
    return next === this ? null : next;
};
LinkedList.prototype.get_prev = function(item) {
    var prev = item[this.prev];
    return prev === this ? null : prev;
};
LinkedList.prototype.get_front = function() {
    return this.get_next(this);
};
LinkedList.prototype.get_back = function() {
    return this.get_prev(this);
};
LinkedList.prototype.is_empty = function() {
    return !this.get_front();
};
LinkedList.prototype.push_front = function(item) {
    return this.insert_after(this, item);
};
LinkedList.prototype.push_back = function(item) {
    return this.insert_before(this, item);
};
LinkedList.prototype.pop_front = function() {
    var item = this.get_front();
    if (item) {
        this.remove(item);
        return item;
    }
};
LinkedList.prototype.pop_back = function() {
    var item = this.get_back();
    if (item) {
        this.remove(item);
        return item;
    }
};

LinkedList.prototype.check_item = function(item) {
    if (item[this.head] !== this) {
        throw new Error('item not member of this linked list');
    }
};
LinkedList.prototype.check_new_item = function(item) {
    if (item[this.head] || item[this.prev] || item[this.next]) {
        throw new Error('new item is already a member of a linked list');
    }
};
LinkedList.prototype.enum_items = function() {
    if (this.is_empty()) {
        return '';
    }

    var cur = this.get_front();
    var str = '' + cur;
    while (cur) {
        cur = this.get_next(cur);
        str += ', ' + cur;
    }

    return str;
};
