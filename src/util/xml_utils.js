/* Copyright (C) 2016 NooBaa */
'use strict';

// see https://en.wikipedia.org/wiki/List_of_XML_and_HTML_character_entity_references#Predefined_entities_in_XML
const XML_CHAR_ENTITY_MAP = Object.freeze({
    '"': '&quot;',
    '&': '&amp;',
    '\'': '&apos;',
    '<': '&lt;',
    '>': '&gt;'
});

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 *
 * fast object to xml encoding, optimized for speed.
 *
 * the object will be traveresed recursively:
 *  - any object will be encoded such that keys are xml tags.
 *  - any array will be encode without introducing new keys, meaning items are flattened.
 *  - string/number/boolean/date will be converted to strings.
 *  - {key: null} will encode an empty tag - <key></key>
 *  - {key: undefined} will not encode the tag at all.
 *  - {key: { _attr:{k1:v1,k2:v2,...}, _content:value } will encode xml attributes on the tag
 *      (_attr can be set on array values too)
 *
 * for example:
 *   { root: [{a:1,b:2}, {a:3}, {b:4}, [[[[{z:42}]]]], {c:{_attr:{d:5}}} ] }
 * will be encoded as (spaces are only for clarity):
 *   <root> <a>1</a> <b>2</b> <a>3</a> <b>4</b> <z>42</z> <c d="5"></c> </root>
 *
 */
function encode_xml(object, ignore_header) {
    let output = ignore_header ? '' : XML_HEADER;
    append_object(s => {
        output += s;
    }, object);
    return output;
}

function append_object(append, object) {
    if (typeof(object) !== 'object') {
        append(encode_xml_str(object));
    } else if (Array.isArray(object)) {
        // arrays are encoded without adding new tags
        // which allows repeating keys with the same name
        for (let i = 0; i < object.length; ++i) {
            append_object(append, object[i]);
        }
    } else {
        // skip any keys from the prototype
        const object_own_keys = Object.keys(object);
        for (const key of object_own_keys) {

            // undefined values skip encoding the key tag altogether
            let val = object[key];
            let val_type = typeof(val);
            if (val_type === 'undefined') continue;

            // keys starting with _ are not considered tag names
            // _content - encode only the value but without a tag
            // otherwise ignore the key and value altogether
            if (key[0] === '_') {
                if (key === '_content') {
                    append_object(append, val);
                }
                continue;
            }

            if (val_type === 'object') {
                if (val && val._attr) {
                    append('<' + key);
                    const attr_keys = Object.keys(val._attr);
                    for (const a of attr_keys) {
                        append(' ' + a + '="' + encode_xml_str(val._attr[a]) + '"');
                    }
                    append('>');
                } else {
                    append('<' + key + '>');
                }
                append_object(append, val);
                append('</' + key + '>');
            } else {
                append('<' + key + '>');
                append(encode_xml_str(val));
                append('</' + key + '>');
            }
        }
    }
}

function encode_xml_str(s) {
    return String(s).replace(/(["&'<>])/g, (str, ch) => XML_CHAR_ENTITY_MAP[ch]);
}

exports.encode_xml = encode_xml;
exports.encode_xml_str = encode_xml_str;
exports.XML_HEADER = XML_HEADER;
